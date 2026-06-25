import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderKind,
  OrderStatus,
  Plan,
  Prisma,
  RedemptionCodeKind,
  RedemptionCodeStatus,
  SubscriptionStatus,
  TrafficPackStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const bytesInGiB = 1024 * 1024 * 1024;

type UserWithTokens = Prisma.UserGetPayload<{
  include: {
    accessTokens: {
      where: { revokedAt: null };
      orderBy: { createdAt: 'asc' };
    };
  };
}>;

type PlanWithBindings = Prisma.PlanGetPayload<{
  include: {
    bindings: {
      include: {
        node: true;
      };
      orderBy: { priority: 'asc' };
    };
  };
}>;

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: {
    user: true;
    plan: true;
    node: true;
    trafficPacks: true;
  };
}>;

type OrderWithRelations = Prisma.ManualOrderGetPayload<{
  include: {
    user: true;
    processedBy: true;
    plan: true;
  };
}>;

type RedemptionCodeWithRelations = Prisma.RedemptionCodeGetPayload<{
  include: {
    plan: true;
    createdBy: true;
    redeemedBy: true;
  };
}>;

@Injectable()
export class ControlPlaneStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async health() {
    const [users, plans, subscriptions, nodes] =
      await this.prisma.$transaction([
        this.prisma.user.count(),
        this.prisma.plan.count(),
        this.prisma.subscription.count(),
        this.prisma.node.count(),
      ]);

    return { users, plans, subscriptions, nodes };
  }

  async getUsers() {
    const users = await this.prisma.user.findMany({
      include: {
        accessTokens: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => this.presentUser(user));
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        accessTokens: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return user ? this.presentUserPrivate(user) : undefined;
  }

  async findUserByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        accessTokens: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return user ? this.presentUserPrivate(user) : undefined;
  }

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    plainPassword?: string;
    role: 'admin' | 'member';
    status: 'active' | 'suspended' | 'banned';
    notes?: string;
    initialPlanId?: string;
    initialNodeId?: string;
  }) {
    try {
      const token = this.generateAccessToken();
      const user = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            passwordHash: input.passwordHash,
            plainPassword: input.plainPassword,
            role: this.toDbUserRole(input.role),
            status: this.toDbUserStatus(input.status),
            notes: input.notes,
          },
        });

        const accessToken = await tx.accessToken.create({
          data: {
            userId: createdUser.id,
            label: 'Primary access token',
            token,
          },
        });

        let createdSubscriptionId: string | null = null;
        if (input.initialPlanId) {
          const startsAt = new Date();
          const { plan, nodeId } = await this.resolvePlanNode(tx, {
            planId: input.initialPlanId,
            requestedNodeId: input.initialNodeId,
          });

          const subscription = await tx.subscription.create({
            data: {
              userId: createdUser.id,
              planId: plan.id,
              nodeId,
              status: SubscriptionStatus.ACTIVE,
              startsAt,
              endsAt: this.buildSubscriptionEndDate(startsAt, plan.durationDays),
              includedTrafficBytes: plan.trafficBytes,
              bonusTrafficBytes: BigInt(0),
              consumedTrafficBytes: BigInt(0),
              speedUpMbpsSnapshot: plan.speedUpMbps,
              speedDownMbpsSnapshot: plan.speedDownMbps,
              deviceLimitSnapshot: plan.deviceLimit,
            },
          });

          createdSubscriptionId = subscription.id;
        }

        return { createdUser, accessToken, createdSubscriptionId };
      });

      return {
        ...this.presentUser({
          ...user.createdUser,
          accessTokens: [user.accessToken],
        }),
        primaryAccessToken: user.accessToken.token,
        provisionedSubscriptionId: user.createdSubscriptionId,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchUser(
    userId: string,
    input: {
      displayName?: string;
      passwordHash?: string;
      plainPassword?: string;
      role?: 'admin' | 'member';
      status?: 'active' | 'suspended' | 'banned';
      notes?: string;
    },
  ) {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: this.withDefinedValues({
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          plainPassword: input.plainPassword,
          role: input.role ? this.toDbUserRole(input.role) : undefined,
          status: input.status ? this.toDbUserStatus(input.status) : undefined,
          notes: input.notes,
        }),
        include: {
          accessTokens: {
            where: { revokedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return this.presentUser(user);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getPlans() {
    const plans = await this.prisma.plan.findMany({
      include: {
        bindings: {
          include: { node: true },
          orderBy: { priority: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return plans.map((plan) => this.presentPlan(plan));
  }

  async getPurchasablePlans() {
    const plans = await this.prisma.plan.findMany({
      where: {
        active: true,
        bindings: {
          some: {
            node: { active: true },
          },
        },
      },
      include: {
        bindings: {
          where: { node: { active: true } },
          include: { node: true },
          orderBy: { priority: 'asc' },
        },
      },
      orderBy: [{ priceCents: 'asc' }, { createdAt: 'asc' }],
    });

    return plans.map((plan) => this.presentPlan(plan));
  }

  async createPlan(input: {
    slug: string;
    name: string;
    description: string;
    active: boolean;
    trafficBytes: number;
    durationDays: number;
    speedUpMbps: number;
    speedDownMbps: number;
    deviceLimit: number;
    priceCents: number;
    accent: string;
  }) {
    try {
      const plan = await this.prisma.plan.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          active: input.active,
          trafficBytes: BigInt(input.trafficBytes),
          durationDays: input.durationDays,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
          deviceLimit: input.deviceLimit,
          priceCents: input.priceCents,
          accent: input.accent,
        },
        include: {
          bindings: {
            include: { node: true },
            orderBy: { priority: 'asc' },
          },
        },
      });

      return this.presentPlan(plan);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchPlan(
    planId: string,
    input: {
      slug?: string;
      name?: string;
      description?: string;
      active?: boolean;
      trafficBytes?: number;
      durationDays?: number;
      speedUpMbps?: number;
      speedDownMbps?: number;
      deviceLimit?: number;
      priceCents?: number;
      accent?: string;
    },
  ) {
    try {
      const plan = await this.prisma.plan.update({
        where: { id: planId },
        data: this.withDefinedValues({
          slug: input.slug,
          name: input.name,
          description: input.description,
          active: input.active,
          trafficBytes:
            input.trafficBytes !== undefined
              ? BigInt(input.trafficBytes)
              : undefined,
          durationDays: input.durationDays,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
          deviceLimit: input.deviceLimit,
          priceCents: input.priceCents,
          accent: input.accent,
        }),
        include: {
          bindings: {
            include: { node: true },
            orderBy: { priority: 'asc' },
          },
        },
      });

      return this.presentPlan(plan);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getPlanBindings() {
    const bindings = await this.prisma.planBinding.findMany({
      include: {
        plan: true,
        node: true,
      },
      orderBy: [{ planId: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
    });

    return bindings.map((binding) => ({
      id: binding.id,
      planId: binding.planId,
      planName: binding.plan.name,
      nodeId: binding.nodeId,
      nodeLabel: binding.node.label,
      priority: binding.priority,
      createdAt: binding.createdAt.toISOString(),
    }));
  }

  async createPlanBinding(input: {
    planId: string;
    nodeId: string;
    priority?: number;
  }) {
    try {
      const binding = await this.prisma.planBinding.create({
        data: {
          planId: input.planId,
          nodeId: input.nodeId,
          priority: input.priority ?? 0,
        },
        include: {
          plan: true,
          node: true,
        },
      });

      return {
        id: binding.id,
        planId: binding.planId,
        planName: binding.plan.name,
        nodeId: binding.nodeId,
        nodeLabel: binding.node.label,
        priority: binding.priority,
        createdAt: binding.createdAt.toISOString(),
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async deletePlanBinding(bindingId: string) {
    try {
      await this.prisma.planBinding.delete({ where: { id: bindingId } });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchPlanBinding(
    bindingId: string,
    input: { nodeId?: string; priority?: number },
  ) {
    try {
      const binding = await this.prisma.planBinding.update({
        where: { id: bindingId },
        data: this.withDefinedValues({ nodeId: input.nodeId, priority: input.priority }),
        include: { plan: true, node: true },
      });

      return {
        id: binding.id,
        planId: binding.planId,
        planName: binding.plan.name,
        nodeId: binding.nodeId,
        nodeLabel: binding.node.label,
        priority: binding.priority,
        createdAt: binding.createdAt.toISOString(),
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getSubscriptions() {
    const subscriptions = await this.prisma.subscription.findMany({
      include: { user: true, plan: true, node: true, trafficPacks: true },
      orderBy: { createdAt: 'desc' },
    });

    return subscriptions.map((s) => this.presentSubscription(s));
  }

  async getActiveSubscriptionForUser(userId: string) {
    await this.expireOverdueSubscriptions();
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: new Date() },
      },
      orderBy: { endsAt: 'desc' },
    });
  }

  async createSubscription(input: {
    userId: string;
    planId: string;
    nodeId?: string;
    status?: 'active' | 'expired' | 'paused' | 'canceled';
    startsAt?: string;
  }) {
    await this.expireOverdueSubscriptions();
    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Invalid startsAt');
    }

    await this.mustGetUserRecord(input.userId);

    const openSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: input.userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED] },
      },
    });
    if (openSubscription) {
      throw new ConflictException('User already has an active or paused subscription');
    }

    const { plan, nodeId } = await this.resolvePlanNode(this.prisma, {
      planId: input.planId,
      requestedNodeId: input.nodeId,
    });

    const endsAt = this.buildSubscriptionEndDate(startsAt, plan.durationDays);

    try {
      const subscription = await this.prisma.subscription.create({
        data: {
          userId: input.userId,
          planId: input.planId,
          nodeId,
          status: input.status
            ? this.toDbSubscriptionStatus(input.status)
            : SubscriptionStatus.ACTIVE,
          startsAt,
          endsAt,
          includedTrafficBytes: plan.trafficBytes,
          bonusTrafficBytes: BigInt(0),
          consumedTrafficBytes: BigInt(0),
          speedUpMbpsSnapshot: plan.speedUpMbps,
          speedDownMbpsSnapshot: plan.speedDownMbps,
          deviceLimitSnapshot: plan.deviceLimit,
        },
        include: { user: true, plan: true, node: true, trafficPacks: true },
      });

      return this.presentSubscription(subscription);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchSubscription(
    subscriptionId: string,
    input: {
      status?: 'active' | 'expired' | 'paused' | 'canceled';
      endsAt?: string;
      nodeId?: string;
      includedTrafficBytes?: number;
      bonusTrafficBytes?: number;
      consumedTrafficBytes?: number;
      speedUpMbpsSnapshot?: number;
      speedDownMbpsSnapshot?: number;
      deviceLimitSnapshot?: number;
    },
  ) {
    const subscription = await this.mustGetSubscriptionRecord(subscriptionId);

    if (input.nodeId) {
      const allowed = await this.prisma.planBinding.findFirst({
        where: { planId: subscription.planId, nodeId: input.nodeId },
      });
      if (!allowed) {
        throw new BadRequestException('Selected node is not bound to this subscription plan');
      }
    }

    try {
      const updated = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: this.withDefinedValues({
          status: input.status ? this.toDbSubscriptionStatus(input.status) : undefined,
          endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
          nodeId: input.nodeId,
          includedTrafficBytes:
            input.includedTrafficBytes !== undefined
              ? BigInt(input.includedTrafficBytes)
              : undefined,
          bonusTrafficBytes:
            input.bonusTrafficBytes !== undefined
              ? BigInt(input.bonusTrafficBytes)
              : undefined,
          consumedTrafficBytes:
            input.consumedTrafficBytes !== undefined
              ? BigInt(input.consumedTrafficBytes)
              : undefined,
          speedUpMbpsSnapshot: input.speedUpMbpsSnapshot,
          speedDownMbpsSnapshot: input.speedDownMbpsSnapshot,
          deviceLimitSnapshot: input.deviceLimitSnapshot,
        }),
        include: { user: true, plan: true, node: true, trafficPacks: true },
      });

      return this.presentSubscription(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getNodes() {
    const nodes = await this.prisma.node.findMany({
      orderBy: { createdAt: 'desc' },
    });

    if (nodes.length === 0) return [];

    const nodeIds = nodes.map((n) => n.id);
    const allSnapshots = await this.prisma.onlineSnapshot.findMany({
      where: { nodeId: { in: nodeIds } },
      orderBy: { capturedAt: 'desc' },
      take: 200 * nodes.length,
    });

    const snapshotsByNode = new Map<string, typeof allSnapshots>();
    for (const snap of allSnapshots) {
      const list = snapshotsByNode.get(snap.nodeId) ?? [];
      list.push(snap);
      snapshotsByNode.set(snap.nodeId, list);
    }

    return nodes.map((node) =>
      this.buildNodeView(node, snapshotsByNode.get(node.id) ?? []),
    );
  }

  async getNodeById(nodeId: string) {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
    return node ? this.presentNode(node) : undefined;
  }

  async createNode(input: {
    label: string;
    hostname: string;
    port: number;
    obfsPassword?: string;
    sni?: string;
    pinSHA256?: string;
    allowInsecureTls: boolean;
    trafficApiBaseUrl: string;
    trafficApiSecret: string;
    active: boolean;
    speedUpMbps: number;
    speedDownMbps: number;
  }) {
    try {
      const node = await this.prisma.node.create({
        data: {
          label: input.label,
          hostname: input.hostname,
          port: input.port,
          obfsPassword: input.obfsPassword,
          sni: input.sni,
          pinSHA256: input.pinSHA256,
          allowInsecureTls: input.allowInsecureTls,
          trafficApiBaseUrl: input.trafficApiBaseUrl,
          trafficApiSecret: input.trafficApiSecret,
          active: input.active,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
        },
      });

      return this.presentNode(node);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchNode(
    nodeId: string,
    input: {
      label?: string;
      hostname?: string;
      port?: number;
      obfsPassword?: string;
      sni?: string;
      pinSHA256?: string;
      allowInsecureTls?: boolean;
      trafficApiBaseUrl?: string;
      trafficApiSecret?: string;
      active?: boolean;
      speedUpMbps?: number;
      speedDownMbps?: number;
    },
  ) {
    try {
      const node = await this.prisma.node.update({
        where: { id: nodeId },
        data: this.withDefinedValues({
          label: input.label,
          hostname: input.hostname,
          port: input.port,
          obfsPassword: input.obfsPassword,
          sni: input.sni,
          pinSHA256: input.pinSHA256,
          allowInsecureTls: input.allowInsecureTls,
          trafficApiBaseUrl: input.trafficApiBaseUrl,
          trafficApiSecret: input.trafficApiSecret,
          active: input.active,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
        }),
      });

      return this.presentNode(node);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async deleteNode(nodeId: string) {
    try {
      await this.prisma.node.delete({ where: { id: nodeId } });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getUsageForUser(userId: string) {
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();

    const subscription = await this.mustGetActiveSubscriptionRecordForUser(userId);
    const packs = await this.prisma.trafficPack.findMany({
      where: { subscriptionId: subscription.id, status: TrafficPackStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
    });

    const baseRemaining = Math.max(
      Number(
        subscription.includedTrafficBytes +
          subscription.bonusTrafficBytes -
          subscription.consumedTrafficBytes,
      ),
      0,
    );
    const packRemaining = packs.reduce((sum, pack) => sum + Number(pack.remainingBytes), 0);
    const recent = await this.prisma.usageRollup.findMany({
      where: { userId },
      orderBy: { bucketStart: 'desc' },
      take: 12,
      include: { node: true },
    });

    return {
      subscriptionId: subscription.id,
      consumedBytes: Number(subscription.consumedTrafficBytes),
      baseRemainingBytes: baseRemaining,
      packRemainingBytes: packRemaining,
      totalRemainingBytes: baseRemaining + packRemaining,
      recent: recent.map((rollup) => ({
        id: rollup.id,
        userId: rollup.userId,
        subscriptionId: rollup.subscriptionId,
        nodeId: rollup.nodeId,
        nodeLabel: rollup.node.label,
        bucketStart: rollup.bucketStart.toISOString(),
        txBytes: Number(rollup.txBytes),
        rxBytes: Number(rollup.rxBytes),
        source: rollup.source,
        createdAt: rollup.createdAt.toISOString(),
      })),
    };
  }

  async getPortalOverview(userId: string) {
    const user = await this.mustGetUserRecord(userId);
    const subscription = await this.mustGetActiveSubscriptionRecordForUser(userId);
    const plan = await this.mustGetPlanRecord(subscription.planId);
    const node = await this.mustGetNodeRecord(subscription.nodeId);
    const usage = await this.getUsageForUser(userId);
    const online = await this.getCurrentOnlineCount(userId);
    const packs = await this.prisma.trafficPack.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      user: this.presentUser({
        ...user,
        accessTokens: await this.prisma.accessToken.findMany({
          where: { userId, revokedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
      }),
      subscription: this.presentSubscription({
        ...subscription,
        user,
        plan,
        node,
        trafficPacks: packs,
      }),
      plan: this.presentPlanShallow(plan),
      nodeLabel: node.label,
      remainingBytes: usage.totalRemainingBytes,
      online,
      packs: packs.map((pack) => this.presentTrafficPack(pack)),
    };
  }

  async getAccessBundle(userId: string) {
    const user = await this.mustGetUserRecord(userId);
    const subscription = await this.mustGetActiveSubscriptionRecordForUser(userId);
    const token = await this.mustGetAccessTokenByUser(userId);
    const node = await this.mustGetNodeRecord(subscription.nodeId);
    const usage = await this.getUsageForUser(userId);

    return {
      user: this.presentUser({ ...user, accessTokens: [token] }),
      subscription: this.presentSubscription({
        ...subscription,
        user,
        plan: await this.mustGetPlanRecord(subscription.planId),
        node,
        trafficPacks: await this.prisma.trafficPack.findMany({
          where: { subscriptionId: subscription.id },
        }),
      }),
      node,
      token,
      trafficRemaining: usage.totalRemainingBytes,
    };
  }

  async createManualOrder(input: {
    userId: string;
    processedById?: string;
    kind: 'renewal' | 'traffic_pack' | 'manual_credit';
    status?: 'pending' | 'applied';
    planId?: string;
    amountCents: number;
    durationDays?: number;
    trafficBytes?: number;
    note?: string;
  }) {
    await this.mustGetUserRecord(input.userId);

    if (input.processedById) {
      await this.mustGetUserRecord(input.processedById);
    }

    if (input.planId) {
      await this.mustGetPlanRecord(input.planId);
    }

    const requestedStatus = input.status ?? 'applied';
    const timestamp = new Date();

    if (input.kind === 'renewal' && !input.planId && !input.durationDays) {
      throw new BadRequestException('Renewal order requires a plan or duration days');
    }

    if (
      input.kind === 'traffic_pack' &&
      (input.trafficBytes === undefined || input.trafficBytes <= 0)
    ) {
      throw new BadRequestException('Traffic pack order requires traffic bytes');
    }

    if (requestedStatus === 'applied' && !input.processedById) {
      throw new BadRequestException('Applied order requires processedById');
    }

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const plan = input.planId
          ? await tx.plan.findUnique({ where: { id: input.planId } })
          : null;

        const createdOrder = await tx.manualOrder.create({
          data: {
            userId: input.userId,
            processedById: requestedStatus === 'applied' ? input.processedById : undefined,
            planId: input.planId,
            status: requestedStatus === 'applied' ? OrderStatus.APPLIED : OrderStatus.PENDING,
            kind: this.toDbOrderKind(input.kind),
            amountCents: input.amountCents,
            durationDays: input.durationDays ?? (plan ? plan.durationDays : undefined),
            trafficBytes:
              input.trafficBytes !== undefined ? BigInt(input.trafficBytes) : undefined,
            note: input.note,
            processedAt: requestedStatus === 'applied' ? timestamp : undefined,
          },
          include: { user: true, processedBy: true, plan: true },
        });

        if (requestedStatus === 'applied') {
          await this.applyManualOrderEffects(tx, createdOrder, timestamp);
        }

        return createdOrder;
      });

      return this.presentManualOrder(order);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async createPlanOrderRequest(input: {
    userId: string;
    planId: string;
    note?: string;
  }) {
    const user = await this.mustGetUserRecord(input.userId);
    const plan = await this.mustGetPlanRecord(input.planId);

    if (!plan.active) {
      throw new BadRequestException('Selected plan is not active');
    }

    await this.resolvePlanNode(this.prisma, { planId: input.planId });

    const existingPending = await this.prisma.manualOrder.findFirst({
      where: {
        userId: input.userId,
        status: OrderStatus.PENDING,
        kind: OrderKind.RENEWAL,
      },
    });

    if (existingPending) {
      throw new ConflictException('User already has a pending plan order awaiting processing');
    }

    try {
      const order = await this.prisma.manualOrder.create({
        data: {
          userId: input.userId,
          planId: plan.id,
          status: OrderStatus.PENDING,
          kind: OrderKind.RENEWAL,
          amountCents: plan.priceCents,
          durationDays: plan.durationDays,
          note: input.note?.trim() || `Plan request for ${plan.name} by ${user.email}`,
        },
        include: { user: true, processedBy: true, plan: true },
      });

      return this.presentManualOrder(order);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchManualOrder(
    orderId: string,
    input: { status?: 'applied' | 'void'; processedById: string },
  ) {
    await this.mustGetUserRecord(input.processedById);

    const current = await this.prisma.manualOrder.findUnique({
      where: { id: orderId },
      include: { user: true, processedBy: true, plan: true },
    });

    if (!current) {
      throw new NotFoundException(`Unknown manual order: ${orderId}`);
    }

    if (current.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Only pending orders can be updated');
    }

    if (!input.status) {
      return this.presentManualOrder(current);
    }

    const processedAt = new Date();

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.manualOrder.update({
          where: { id: orderId },
          data: {
            processedById: input.processedById,
            status: input.status === 'void' ? OrderStatus.VOID : OrderStatus.APPLIED,
            processedAt,
          },
          include: { user: true, processedBy: true, plan: true },
        });

        if (input.status === 'applied') {
          await this.applyManualOrderEffects(tx, updated, processedAt);
        }

        return updated;
      });

      return this.presentManualOrder(order);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async recordAuthEvent(event: {
    userId?: string;
    accessTokenId?: string;
    nodeId?: string;
    granted: boolean;
    reason: string;
    remoteAddr?: string;
    requestedTxBps?: number;
    submittedTokenPreview?: string;
  }) {
    return this.prisma.authEvent.create({ data: event });
  }

  async markTokenUsed(accessTokenId: string) {
    await this.prisma.accessToken.update({
      where: { id: accessTokenId },
      data: { lastUsedAt: new Date() },
    });
  }

  async findAccessToken(tokenValue: string) {
    return this.prisma.accessToken.findFirst({
      where: { token: tokenValue, revokedAt: null },
    });
  }

  async authorizeHysteriaAccess(input: {
    tokenValue: string;
    nodeId: string;
    remoteAddr?: string;
    requestedTxBps?: number;
  }) {
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();

    const token = await this.prisma.accessToken.findFirst({
      where: { token: input.tokenValue, revokedAt: null },
    });
    if (!token) {
      return this.rejectAuth('token_not_found', input);
    }

    const user = await this.mustGetUserRecord(token.userId);
    const node = await this.prisma.node.findUnique({ where: { id: input.nodeId } });

    if (!node || !node.active) {
      return this.rejectAuth('node_unavailable', input, token.id, user.id, node?.id);
    }

    if (user.status !== UserStatus.ACTIVE) {
      return this.rejectAuth('user_not_active', input, token.id, user.id, node.id);
    }

    const subscription = await this.getActiveSubscriptionForUser(user.id);
    if (!subscription) {
      return this.rejectAuth('subscription_missing', input, token.id, user.id, node.id);
    }

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      return this.rejectAuth('subscription_not_active', input, token.id, user.id, node.id);
    }

    if (subscription.endsAt.getTime() <= Date.now()) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.EXPIRED },
      });
      return this.rejectAuth('subscription_expired', input, token.id, user.id, node.id);
    }

    // Check node is bound to this subscription's plan
    const bindingAllowed = await this.prisma.planBinding.findFirst({
      where: { planId: subscription.planId, nodeId: node.id },
    });
    if (!bindingAllowed) {
      return this.rejectAuth('node_forbidden', input, token.id, user.id, node.id);
    }

    const usage = await this.getUsageForUser(user.id);
    if (usage.totalRemainingBytes <= 0) {
      return this.rejectAuth('traffic_exhausted', input, token.id, user.id, node.id);
    }

    const onlineCount = await this.getCurrentOnlineCount(user.id);
    if (onlineCount >= subscription.deviceLimitSnapshot) {
      return this.rejectAuth('device_limit_exceeded', input, token.id, user.id, node.id);
    }

    await this.markTokenUsed(token.id);
    await this.recordAuthEvent({
      userId: user.id,
      accessTokenId: token.id,
      nodeId: node.id,
      granted: true,
      reason: 'ok',
      remoteAddr: input.remoteAddr,
      requestedTxBps: input.requestedTxBps,
      submittedTokenPreview: this.previewToken(input.tokenValue),
    });

    return { ok: true as const, id: user.id };
  }

  async applyTrafficSnapshot(
    nodeId: string,
    trafficMap: Record<string, { tx: number; rx: number }>,
  ) {
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();

    const settled = await Promise.allSettled(
      Object.entries(trafficMap).map(([userId, counters]) =>
        this.applyUserTraffic(nodeId, userId, counters),
      ),
    );

    const impactedUsers: string[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value !== null) {
        impactedUsers.push(result.value);
      }
    }
    return impactedUsers;
  }

  private async applyUserTraffic(
    nodeId: string,
    userId: string,
    counters: { tx: number; rx: number },
  ): Promise<string | null> {
    let impacted = false;

    await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findFirst({
        where: {
          userId,
          status: SubscriptionStatus.ACTIVE,
          endsAt: { gt: new Date() },
        },
        orderBy: { endsAt: 'desc' },
      });

      if (!subscription) return;

      impacted = true;
      let remaining = counters.tx + counters.rx;
      const baseRemaining = Math.max(
        Number(
          subscription.includedTrafficBytes +
            subscription.bonusTrafficBytes -
            subscription.consumedTrafficBytes,
        ),
        0,
      );

      if (baseRemaining > 0) {
        const consumeBase = Math.min(baseRemaining, remaining);
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            consumedTrafficBytes:
              subscription.consumedTrafficBytes + BigInt(consumeBase),
          },
        });
        remaining -= consumeBase;
      }

      if (remaining > 0) {
        const packs = await tx.trafficPack.findMany({
          where: { subscriptionId: subscription.id, status: TrafficPackStatus.ACTIVE },
          orderBy: { createdAt: 'asc' },
        });

        for (const pack of packs) {
          if (remaining <= 0) break;

          const consume = Math.min(Number(pack.remainingBytes), remaining);
          const nextRemaining = Number(pack.remainingBytes) - consume;

          await tx.trafficPack.update({
            where: { id: pack.id },
            data: {
              remainingBytes: BigInt(nextRemaining),
              status:
                nextRemaining <= 0 ? TrafficPackStatus.EXHAUSTED : TrafficPackStatus.ACTIVE,
            },
          });

          remaining -= consume;
        }
      }

      await tx.usageRollup.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          nodeId,
          bucketStart: new Date(),
          txBytes: BigInt(counters.tx),
          rxBytes: BigInt(counters.rx),
          source: 'sync',
        },
      });
    });

    return impacted ? userId : null;
  }

  async applyOnlineSnapshot(nodeId: string, onlineMap: Record<string, number>) {
    const previous = await this.prisma.onlineSnapshot.findMany({
      where: { nodeId },
      orderBy: { capturedAt: 'desc' },
      include: { user: true },
    });

    const latestUsers = new Set<string>();
    const latestByUser = new Map<string, number>();
    for (const snapshot of previous) {
      if (!latestUsers.has(snapshot.userId)) {
        latestUsers.add(snapshot.userId);
        latestByUser.set(snapshot.userId, snapshot.concurrentClients);
      }
    }

    const mergedUsers = new Set([...Object.keys(onlineMap), ...latestByUser.keys()]);
    if (mergedUsers.size === 0) return;

    await this.prisma.onlineSnapshot.createMany({
      data: [...mergedUsers].map((userId) => ({
        userId,
        nodeId,
        concurrentClients: onlineMap[userId] ?? 0,
        capturedAt: new Date(),
      })),
    });
  }

  async getCurrentOnlineCount(userId: string) {
    const snapshots = await this.prisma.onlineSnapshot.findMany({
      where: { userId },
      orderBy: { capturedAt: 'desc' },
    });

    const latestByNode = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (!latestByNode.has(snapshot.nodeId)) {
        latestByNode.set(snapshot.nodeId, snapshot.concurrentClients);
      }
    }

    return [...latestByNode.values()].reduce((sum, value) => sum + value, 0);
  }

  async validateUserIsRestricted(userId: string) {
    const user = await this.mustGetUserRecord(userId);
    if (user.status !== UserStatus.ACTIVE) return true;

    const subscription = await this.getActiveSubscriptionForUser(userId);
    if (!subscription) return true;

    if (subscription.status !== SubscriptionStatus.ACTIVE) return true;

    if (subscription.endsAt.getTime() <= Date.now()) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.EXPIRED },
      });
      return true;
    }

    return (await this.getUsageForUser(userId)).totalRemainingBytes <= 0;
  }

  async getNodeIdsForUser(userId: string) {
    const subscription = await this.getActiveSubscriptionForUser(userId);
    if (!subscription) return [];

    // Return all nodes bound to the subscription's plan that are active
    const bindings = await this.prisma.planBinding.findMany({
      where: { planId: subscription.planId },
      include: { node: { select: { id: true, active: true } } },
    });

    return bindings
      .filter((b) => b.node.active)
      .map((b) => b.node.id);
  }

  async getManualOrders() {
    const orders = await this.prisma.manualOrder.findMany({
      include: { user: true, processedBy: true, plan: true },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => this.presentManualOrder(order));
  }

  async getManualOrdersForUser(userId: string) {
    const orders = await this.prisma.manualOrder.findMany({
      where: { userId },
      include: { user: true, processedBy: true, plan: true },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => this.presentManualOrder(order));
  }

  async getRedemptionCodes() {
    await this.expireRedemptionCodes();

    const codes = await this.prisma.redemptionCode.findMany({
      include: { plan: true, createdBy: true, redeemedBy: true },
      orderBy: { createdAt: 'desc' },
    });

    return codes.map((code) => this.presentRedemptionCode(code));
  }

  async createRedemptionCode(input: {
    label: string;
    code?: string;
    kind: 'plan' | 'traffic_pack';
    planId?: string;
    trafficBytes?: number;
    amountCents?: number;
    note?: string;
    expiresAt?: string;
    createdById?: string;
  }) {
    if (input.kind === 'plan' && !input.planId) {
      throw new BadRequestException('Plan redemption code requires a plan');
    }

    if (input.kind === 'traffic_pack' && !input.trafficBytes) {
      throw new BadRequestException('Traffic pack redemption code requires traffic bytes');
    }

    if (input.planId) {
      await this.mustGetPlanRecord(input.planId);
    }

    if (input.createdById) {
      await this.mustGetUserRecord(input.createdById);
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Invalid expiresAt');
    }

    if (input.code) {
      const exists = await this.prisma.redemptionCode.findUnique({
        where: { code: input.code },
        select: { id: true },
      });
      if (exists) throw new ConflictException(`Redemption code "${input.code}" already exists`);
    }

    try {
      const code = await this.prisma.redemptionCode.create({
        data: {
          code: input.code ?? await this.generateUniqueRedemptionCode(),
          label: input.label,
          kind: this.toDbRedemptionCodeKind(input.kind),
          planId: input.planId,
          trafficBytes:
            input.trafficBytes !== undefined ? BigInt(input.trafficBytes) : undefined,
          amountCents: input.amountCents ?? 0,
          note: input.note,
          expiresAt,
          createdById: input.createdById,
        },
        include: { plan: true, createdBy: true, redeemedBy: true },
      });

      return this.presentRedemptionCode(code);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchRedemptionCode(codeId: string, input: { status?: 'active' | 'void' }) {
    const current = await this.prisma.redemptionCode.findUnique({
      where: { id: codeId },
      include: { plan: true, createdBy: true, redeemedBy: true },
    });

    if (!current) {
      throw new NotFoundException(`Unknown redemption code: ${codeId}`);
    }

    if (
      current.status === RedemptionCodeStatus.REDEEMED &&
      input.status &&
      input.status !== 'void'
    ) {
      throw new BadRequestException('Redeemed code cannot be reactivated');
    }

    if (
      current.status === RedemptionCodeStatus.EXPIRED &&
      input.status &&
      input.status !== 'void'
    ) {
      throw new BadRequestException('Expired code cannot be reactivated');
    }

    try {
      const updated = await this.prisma.redemptionCode.update({
        where: { id: codeId },
        data: this.withDefinedValues({
          status: input.status ? this.toDbRedemptionCodeStatus(input.status) : undefined,
        }),
        include: { plan: true, createdBy: true, redeemedBy: true },
      });

      return this.presentRedemptionCode(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async redeemRedemptionCode(userId: string, rawCode: string) {
    await this.mustGetUserRecord(userId);
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();
    await this.expireRedemptionCodes();

    const codeValue = this.normalizeRedemptionCode(rawCode);
    const existing = await this.prisma.redemptionCode.findUnique({
      where: { code: codeValue },
      include: { plan: true, createdBy: true, redeemedBy: true },
    });

    if (!existing) throw new NotFoundException('兑换码不存在');
    if (existing.status === RedemptionCodeStatus.REDEEMED) throw new BadRequestException('兑换码已被使用');
    if (existing.status === RedemptionCodeStatus.VOID) throw new BadRequestException('兑换码已作废');
    if (existing.status === RedemptionCodeStatus.EXPIRED) throw new BadRequestException('兑换码已过期');

    if (existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) {
      await this.prisma.redemptionCode.update({
        where: { id: existing.id },
        data: { status: RedemptionCodeStatus.EXPIRED },
      });
      throw new BadRequestException('兑换码已过期');
    }

    const timestamp = new Date();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const code = await tx.redemptionCode.findUnique({
          where: { id: existing.id },
          include: { plan: true, createdBy: true, redeemedBy: true },
        });

        if (!code) throw new NotFoundException('兑换码不存在');
        if (code.status !== RedemptionCodeStatus.ACTIVE) throw new BadRequestException('兑换码当前不可使用');

        const openSubscription = await this.findOpenSubscriptionForUser(tx, userId);

        const order =
          code.kind === RedemptionCodeKind.PLAN
            ? await this.applyPlanRedemptionCode(tx, {
                userId,
                code,
                openSubscription,
                redeemedAt: timestamp,
              })
            : await this.applyTrafficPackRedemptionCode(tx, {
                userId,
                code,
                openSubscription,
                redeemedAt: timestamp,
              });

        const redeemedCode = await tx.redemptionCode.update({
          where: { id: code.id },
          data: {
            status: RedemptionCodeStatus.REDEEMED,
            redeemedById: userId,
            redeemedAt: timestamp,
          },
          include: { plan: true, createdBy: true, redeemedBy: true },
        });

        return { code: redeemedCode, order };
      });

      return {
        code: this.presentRedemptionCode(result.code),
        order: this.presentManualOrder(result.order),
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getAuthEvents(limit = 20) {
    const events = await this.prisma.authEvent.findMany({
      include: { user: true, accessToken: true, node: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return events.map((event) => ({
      id: event.id,
      userId: event.userId,
      userEmail: event.user?.email,
      accessTokenId: event.accessTokenId,
      tokenPreview:
        event.accessToken?.token && this.previewToken(event.accessToken.token),
      nodeId: event.nodeId,
      nodeLabel: event.node?.label,
      granted: event.granted,
      reason: event.reason,
      remoteAddr: event.remoteAddr,
      requestedTxBps: event.requestedTxBps,
      submittedTokenPreview: event.submittedTokenPreview,
      createdAt: event.createdAt.toISOString(),
    }));
  }

  async getUsageRollups(limit = 30) {
    const rollups = await this.prisma.usageRollup.findMany({
      include: { user: true, node: true },
      orderBy: { bucketStart: 'desc' },
      take: limit,
    });

    return rollups.map((rollup) => ({
      id: rollup.id,
      userId: rollup.userId,
      userEmail: rollup.user.email,
      subscriptionId: rollup.subscriptionId,
      nodeId: rollup.nodeId,
      nodeLabel: rollup.node.label,
      bucketStart: rollup.bucketStart.toISOString(),
      txBytes: Number(rollup.txBytes),
      rxBytes: Number(rollup.rxBytes),
      source: rollup.source,
      createdAt: rollup.createdAt.toISOString(),
    }));
  }

  async getUserSubscription(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId },
      include: { user: true, plan: true, node: true, trafficPacks: true },
      orderBy: { createdAt: 'desc' },
    });
    return sub ? this.presentSubscription(sub) : null;
  }

  async getUsageRollupsByUser(userId: string, limit = 30) {
    const rollups = await this.prisma.usageRollup.findMany({
      where: { userId },
      include: { user: true, node: true },
      orderBy: { bucketStart: 'desc' },
      take: limit,
    });
    return rollups.map((rollup) => ({
      id: rollup.id,
      userId: rollup.userId,
      userEmail: rollup.user.email,
      subscriptionId: rollup.subscriptionId,
      nodeId: rollup.nodeId,
      nodeLabel: rollup.node.label,
      bucketStart: rollup.bucketStart.toISOString(),
      txBytes: Number(rollup.txBytes),
      rxBytes: Number(rollup.rxBytes),
      source: rollup.source,
      createdAt: rollup.createdAt.toISOString(),
    }));
  }

  async getCurrentSessions(limit = 50) {
    const snapshots = await this.prisma.onlineSnapshot.findMany({
      include: { user: true, node: true },
      orderBy: { capturedAt: 'desc' },
      take: 500,
    });

    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      const key = `${snapshot.userId}:${snapshot.nodeId}`;
      if (!latest.has(key)) latest.set(key, snapshot);
    }

    return [...latest.values()]
      .filter((snapshot) => snapshot.concurrentClients > 0)
      .slice(0, limit)
      .map((snapshot) => ({
        userId: snapshot.userId,
        userEmail: snapshot.user.email,
        nodeId: snapshot.nodeId,
        nodeLabel: snapshot.node.label,
        concurrentClients: snapshot.concurrentClients,
        capturedAt: snapshot.capturedAt.toISOString(),
      }));
  }

  previewToken(token: string) {
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
  }

  humanizeBytes(bytes: number) {
    return `${(bytes / bytesInGiB).toFixed(1)} GB`;
  }

  private async applyPlanRedemptionCode(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      code: RedemptionCodeWithRelations;
      openSubscription: Prisma.SubscriptionGetPayload<object> | null;
      redeemedAt: Date;
    },
  ) {
    if (!input.code.planId) {
      throw new BadRequestException('Plan redemption code is missing a plan');
    }

    const plan = await this.mustGetPlanRecord(input.code.planId);

    const order = await tx.manualOrder.create({
      data: {
        userId: input.userId,
        planId: plan.id,
        status: OrderStatus.APPLIED,
        kind: OrderKind.RENEWAL,
        amountCents: input.code.amountCents,
        durationDays: plan.durationDays,
        note: input.code.note || `Redeemed ${input.code.code}`,
        processedAt: input.redeemedAt,
      },
      include: { user: true, processedBy: true, plan: true },
    });

    await this.grantPlanEntitlement(tx, {
      userId: input.userId,
      planId: plan.id,
      grantedAt: input.redeemedAt,
      openSubscription: input.openSubscription,
    });

    return order;
  }

  private async applyManualOrderEffects(
    tx: Prisma.TransactionClient,
    order: Prisma.ManualOrderGetPayload<{ include: { plan: true } }>,
    processedAt: Date,
  ) {
    if (order.kind === OrderKind.RENEWAL) {
      if (order.planId) {
        await this.grantPlanEntitlement(tx, {
          userId: order.userId,
          planId: order.planId,
          grantedAt: processedAt,
        });
        return;
      }

      if (!order.durationDays || order.durationDays <= 0) {
        throw new BadRequestException('Renewal order is missing duration or plan information');
      }

      const subscription = await this.requireOpenSubscription(tx, order.userId);
      const extensionBase =
        subscription.endsAt.getTime() > processedAt.getTime()
          ? new Date(subscription.endsAt)
          : new Date(processedAt);
      extensionBase.setUTCDate(extensionBase.getUTCDate() + order.durationDays);

      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.ACTIVE, endsAt: extensionBase },
      });
      return;
    }

    if (order.kind === OrderKind.TRAFFIC_PACK) {
      if (!order.trafficBytes || order.trafficBytes <= BigInt(0)) {
        throw new BadRequestException('Traffic pack order is missing traffic bytes');
      }
    }

    if (
      order.kind === OrderKind.MANUAL_CREDIT &&
      (!order.durationDays || order.durationDays <= 0) &&
      (!order.trafficBytes || order.trafficBytes <= BigInt(0))
    ) {
      throw new BadRequestException('Manual credit order must grant duration days or traffic bytes');
    }

    const subscription = await this.requireOpenSubscription(tx, order.userId);
    let effectiveEndsAt = subscription.endsAt;

    if (order.kind === OrderKind.MANUAL_CREDIT && order.durationDays) {
      const extensionBase =
        subscription.endsAt.getTime() > processedAt.getTime()
          ? new Date(subscription.endsAt)
          : new Date(processedAt);
      extensionBase.setUTCDate(extensionBase.getUTCDate() + order.durationDays);

      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.ACTIVE, endsAt: extensionBase },
      });
      effectiveEndsAt = extensionBase;
    }

    if (order.trafficBytes && order.trafficBytes > BigInt(0)) {
      await tx.trafficPack.create({
        data: {
          userId: subscription.userId,
          subscriptionId: subscription.id,
          label:
            order.note ||
            (order.kind === OrderKind.TRAFFIC_PACK ? 'Manual traffic pack' : 'Manual top-up'),
          totalBytes: order.trafficBytes,
          remainingBytes: order.trafficBytes,
          status: TrafficPackStatus.ACTIVE,
          expiresAt: effectiveEndsAt,
        },
      });
    }
  }

  private async grantPlanEntitlement(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      planId: string;
      grantedAt: Date;
      openSubscription?: Prisma.SubscriptionGetPayload<object> | null;
    },
  ) {
    const existingSubscription =
      input.openSubscription !== undefined
        ? input.openSubscription
        : await tx.subscription.findFirst({
            where: {
              userId: input.userId,
              status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED] },
            },
            orderBy: { endsAt: 'desc' },
          });

    const { plan, nodeId } = await this.resolvePlanNode(tx, { planId: input.planId });

    if (existingSubscription) {
      const extensionBase =
        existingSubscription.endsAt.getTime() > input.grantedAt.getTime()
          ? new Date(existingSubscription.endsAt)
          : new Date(input.grantedAt);
      extensionBase.setUTCDate(extensionBase.getUTCDate() + plan.durationDays);

      await tx.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          planId: plan.id,
          nodeId,
          status: SubscriptionStatus.ACTIVE,
          endsAt: extensionBase,
          includedTrafficBytes:
            existingSubscription.includedTrafficBytes + plan.trafficBytes,
          speedUpMbpsSnapshot: plan.speedUpMbps,
          speedDownMbpsSnapshot: plan.speedDownMbps,
          deviceLimitSnapshot: plan.deviceLimit,
        },
      });
      return;
    }

    await tx.subscription.create({
      data: {
        userId: input.userId,
        planId: plan.id,
        nodeId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: input.grantedAt,
        endsAt: this.buildSubscriptionEndDate(input.grantedAt, plan.durationDays),
        includedTrafficBytes: plan.trafficBytes,
        bonusTrafficBytes: BigInt(0),
        consumedTrafficBytes: BigInt(0),
        speedUpMbpsSnapshot: plan.speedUpMbps,
        speedDownMbpsSnapshot: plan.speedDownMbps,
        deviceLimitSnapshot: plan.deviceLimit,
      },
    });
  }

  private async applyTrafficPackRedemptionCode(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      code: RedemptionCodeWithRelations;
      openSubscription: Prisma.SubscriptionGetPayload<object> | null;
      redeemedAt: Date;
    },
  ) {
    if (!input.openSubscription) {
      throw new BadRequestException('流量包兑换需要先有生效中的套餐');
    }

    if (!input.code.trafficBytes || input.code.trafficBytes <= BigInt(0)) {
      throw new BadRequestException('Traffic pack redemption code is missing traffic bytes');
    }

    const order = await tx.manualOrder.create({
      data: {
        userId: input.userId,
        status: OrderStatus.APPLIED,
        kind: OrderKind.TRAFFIC_PACK,
        amountCents: input.code.amountCents,
        trafficBytes: input.code.trafficBytes,
        note: input.code.note || `Redeemed ${input.code.code}`,
        processedAt: input.redeemedAt,
      },
      include: { user: true, processedBy: true, plan: true },
    });

    await tx.trafficPack.create({
      data: {
        userId: input.userId,
        subscriptionId: input.openSubscription.id,
        label: input.code.label,
        totalBytes: input.code.trafficBytes,
        remainingBytes: input.code.trafficBytes,
        status: TrafficPackStatus.ACTIVE,
        expiresAt: input.openSubscription.endsAt,
      },
    });

    return order;
  }

  private async rejectAuth(
    reason: string,
    input: {
      tokenValue: string;
      nodeId: string;
      remoteAddr?: string;
      requestedTxBps?: number;
    },
    accessTokenId?: string,
    userId?: string,
    nodeId?: string,
  ) {
    await this.recordAuthEvent({
      userId,
      accessTokenId,
      nodeId,
      granted: false,
      reason,
      remoteAddr: input.remoteAddr,
      requestedTxBps: input.requestedTxBps,
      submittedTokenPreview: this.previewToken(input.tokenValue),
    });

    return { ok: false as const, reason };
  }

  private presentUser(user: UserWithTokens) {
    const primaryToken = user.accessTokens[0];

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: this.fromDbUserRole(user.role),
      status: this.fromDbUserStatus(user.status),
      notes: user.notes,
      plainPassword: user.plainPassword ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      primaryAccessTokenPreview: primaryToken
        ? this.previewToken(primaryToken.token)
        : null,
      primaryAccessTokenLastUsedAt:
        primaryToken?.lastUsedAt?.toISOString() ?? null,
    };
  }

  private presentUserPrivate(user: UserWithTokens) {
    return { ...this.presentUser(user), passwordHash: user.passwordHash };
  }

  private presentPlan(plan: PlanWithBindings) {
    return {
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      description: plan.description,
      active: plan.active,
      trafficBytes: Number(plan.trafficBytes),
      durationDays: plan.durationDays,
      speedUpMbps: plan.speedUpMbps,
      speedDownMbps: plan.speedDownMbps,
      deviceLimit: plan.deviceLimit,
      priceCents: plan.priceCents,
      accent: plan.accent,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      boundNodes: plan.bindings.map((b) => b.node.label),
      bindings: plan.bindings.map((b) => ({
        id: b.id,
        nodeId: b.nodeId,
        nodeLabel: b.node.label,
        priority: b.priority,
      })),
    };
  }

  private presentPlanShallow(plan: Plan) {
    return {
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      description: plan.description,
      active: plan.active,
      trafficBytes: Number(plan.trafficBytes),
      durationDays: plan.durationDays,
      speedUpMbps: plan.speedUpMbps,
      speedDownMbps: plan.speedDownMbps,
      deviceLimit: plan.deviceLimit,
      priceCents: plan.priceCents,
      accent: plan.accent,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  private presentSubscription(subscription: SubscriptionWithRelations) {
    const remaining = this.getRemainingTrafficForSubscription(
      subscription.includedTrafficBytes,
      subscription.bonusTrafficBytes,
      subscription.consumedTrafficBytes,
      subscription.trafficPacks,
    );

    return {
      id: subscription.id,
      userId: subscription.userId,
      userEmail: subscription.user.email,
      userDisplayName: subscription.user.displayName,
      planId: subscription.planId,
      planName: subscription.plan.name,
      nodeId: subscription.nodeId,
      nodeLabel: subscription.node.label,
      status: this.fromDbSubscriptionStatus(subscription.status),
      startsAt: subscription.startsAt.toISOString(),
      endsAt: subscription.endsAt.toISOString(),
      includedTrafficBytes: Number(subscription.includedTrafficBytes),
      bonusTrafficBytes: Number(subscription.bonusTrafficBytes),
      consumedTrafficBytes: Number(subscription.consumedTrafficBytes),
      speedUpMbpsSnapshot: subscription.speedUpMbpsSnapshot,
      speedDownMbpsSnapshot: subscription.speedDownMbpsSnapshot,
      deviceLimitSnapshot: subscription.deviceLimitSnapshot,
      trafficRemainingBytes: remaining,
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    };
  }

  private async presentNode(node: Prisma.NodeGetPayload<object>) {
    const snapshots = await this.prisma.onlineSnapshot.findMany({
      where: { nodeId: node.id },
      orderBy: { capturedAt: 'desc' },
      take: 200,
    });
    return this.buildNodeView(node, snapshots);
  }

  private buildNodeView(
    node: Prisma.NodeGetPayload<object>,
    snapshots: { userId: string; concurrentClients: number }[],
  ) {
    const latestUsers = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (!latestUsers.has(snapshot.userId)) {
        latestUsers.set(snapshot.userId, snapshot.concurrentClients);
      }
    }

    return {
      id: node.id,
      label: node.label,
      hostname: node.hostname,
      port: node.port,
      obfsPassword: node.obfsPassword,
      sni: node.sni,
      pinSHA256: node.pinSHA256,
      allowInsecureTls: node.allowInsecureTls,
      trafficApiBaseUrl: node.trafficApiBaseUrl,
      trafficApiSecret: node.trafficApiSecret,
      active: node.active,
      speedUpMbps: node.speedUpMbps,
      speedDownMbps: node.speedDownMbps,
      concurrentUsers: [...latestUsers.values()].filter((value) => value > 0).length,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    };
  }

  private presentTrafficPack(pack: Prisma.TrafficPackGetPayload<object>) {
    return {
      id: pack.id,
      userId: pack.userId,
      subscriptionId: pack.subscriptionId,
      label: pack.label,
      totalBytes: Number(pack.totalBytes),
      remainingBytes: Number(pack.remainingBytes),
      status: this.fromDbTrafficPackStatus(pack.status),
      expiresAt: pack.expiresAt?.toISOString() ?? null,
      createdAt: pack.createdAt.toISOString(),
      updatedAt: pack.updatedAt.toISOString(),
    };
  }

  private presentManualOrder(order: OrderWithRelations) {
    return {
      id: order.id,
      userId: order.userId,
      userEmail: order.user.email,
      userDisplayName: order.user.displayName,
      processedById: order.processedById,
      processedByEmail: order.processedBy?.email ?? null,
      planId: order.planId ?? null,
      planName: order.plan?.name ?? null,
      status: this.fromDbOrderStatus(order.status),
      kind: this.fromDbOrderKind(order.kind),
      amountCents: order.amountCents,
      durationDays: order.durationDays,
      trafficBytes:
        order.trafficBytes !== null && order.trafficBytes !== undefined
          ? Number(order.trafficBytes)
          : null,
      note: order.note,
      createdAt: order.createdAt.toISOString(),
      processedAt: order.processedAt?.toISOString() ?? null,
    };
  }

  private presentRedemptionCode(code: RedemptionCodeWithRelations) {
    return {
      id: code.id,
      code: code.code,
      label: code.label,
      kind: this.fromDbRedemptionCodeKind(code.kind),
      status: this.fromDbRedemptionCodeStatus(code.status),
      planId: code.planId,
      planName: code.plan?.name ?? null,
      trafficBytes:
        code.trafficBytes !== null && code.trafficBytes !== undefined
          ? Number(code.trafficBytes)
          : null,
      amountCents: code.amountCents,
      note: code.note,
      expiresAt: code.expiresAt?.toISOString() ?? null,
      createdById: code.createdById,
      createdByEmail: code.createdBy?.email ?? null,
      redeemedById: code.redeemedById,
      redeemedByEmail: code.redeemedBy?.email ?? null,
      redeemedAt: code.redeemedAt?.toISOString() ?? null,
      createdAt: code.createdAt.toISOString(),
      updatedAt: code.updatedAt.toISOString(),
    };
  }

  private getRemainingTrafficForSubscription(
    includedTrafficBytes: bigint,
    bonusTrafficBytes: bigint,
    consumedTrafficBytes: bigint,
    packs: { remainingBytes: bigint; status: TrafficPackStatus }[],
  ) {
    const baseRemaining = Math.max(
      Number(includedTrafficBytes + bonusTrafficBytes - consumedTrafficBytes),
      0,
    );
    const packRemaining = packs
      .filter((p) => p.status === TrafficPackStatus.ACTIVE)
      .reduce((sum, pack) => sum + Number(pack.remainingBytes), 0);

    return baseRemaining + packRemaining;
  }

  private async mustGetUserRecord(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`Unknown user: ${userId}`);
    return user;
  }

  private async mustGetPlanRecord(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Unknown plan: ${planId}`);
    return plan;
  }

  private async mustGetNodeRecord(nodeId: string) {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) throw new NotFoundException(`Unknown node: ${nodeId}`);
    return node;
  }

  private async mustGetSubscriptionRecord(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription) throw new NotFoundException(`Unknown subscription: ${subscriptionId}`);
    return subscription;
  }

  private async findOpenSubscriptionForUser(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
  ) {
    return tx.subscription.findFirst({
      where: {
        userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED] },
      },
      orderBy: { endsAt: 'desc' },
    });
  }

  private async requireOpenSubscription(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
  ) {
    const subscription = await this.findOpenSubscriptionForUser(tx, userId);
    if (!subscription) {
      throw new BadRequestException(
        'This order requires an existing active or paused subscription',
      );
    }
    return subscription;
  }

  private async mustGetActiveSubscriptionRecordForUser(userId: string) {
    const subscription = await this.getActiveSubscriptionForUser(userId);
    if (!subscription) throw new NotFoundException(`No active subscription for user: ${userId}`);
    return subscription;
  }

  private async mustGetAccessTokenByUser(userId: string) {
    const token = await this.prisma.accessToken.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!token) throw new NotFoundException(`No access token for user: ${userId}`);
    return token;
  }

  private async expireOverdueSubscriptions() {
    await this.prisma.subscription.updateMany({
      where: { status: SubscriptionStatus.ACTIVE, endsAt: { lte: new Date() } },
      data: { status: SubscriptionStatus.EXPIRED },
    });
  }

  private async expireTrafficPacks() {
    await this.prisma.trafficPack.updateMany({
      where: { status: TrafficPackStatus.ACTIVE, expiresAt: { lte: new Date() } },
      data: { status: TrafficPackStatus.EXPIRED },
    });
  }

  private async expireRedemptionCodes() {
    await this.prisma.redemptionCode.updateMany({
      where: { status: RedemptionCodeStatus.ACTIVE, expiresAt: { lte: new Date() } },
      data: { status: RedemptionCodeStatus.EXPIRED },
    });
  }

  private generateAccessToken() {
    return `hy2_${randomBytes(12).toString('hex')}`;
  }

  private async generateUniqueRedemptionCode() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = this.generateRedemptionCode();
      const exists = await this.prisma.redemptionCode.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!exists) return code;
    }

    throw new ConflictException('Failed to generate a unique redemption code');
  }

  private generateRedemptionCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(12);
    const chars = Array.from(bytes, (value) => alphabet[value % alphabet.length]);
    return `HY2-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
  }

  private normalizeRedemptionCode(value: string) {
    return value.trim().toUpperCase();
  }

  private buildSubscriptionEndDate(startsAt: Date, durationDays: number) {
    const endsAt = new Date(startsAt);
    endsAt.setUTCDate(endsAt.getUTCDate() + durationDays);
    return endsAt;
  }

  private async resolvePlanNode(
    tx: Prisma.TransactionClient | PrismaService,
    input: { planId: string; requestedNodeId?: string },
  ) {
    const plan = await tx.plan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new NotFoundException(`Unknown plan: ${input.planId}`);

    const bindings = await tx.planBinding.findMany({
      where: { planId: input.planId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    const nodeId = input.requestedNodeId ?? bindings[0]?.nodeId ?? null;
    if (!nodeId) {
      throw new BadRequestException('Plan has no bound nodes; add a node binding to this plan first');
    }

    const bindingAllowed = bindings.some((b) => b.nodeId === nodeId);
    if (!bindingAllowed) {
      throw new BadRequestException('Selected node is not bound to this plan');
    }

    const node = await tx.node.findUnique({ where: { id: nodeId } });
    if (!node) throw new NotFoundException(`Unknown node: ${nodeId}`);

    return { plan, nodeId, node };
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = error.meta?.target;
        const fields = Array.isArray(error.meta?.target)
          ? error.meta.target.join(', ')
          : typeof target === 'string'
            ? target
            : 'unknown field';
        throw new ConflictException(`Duplicate value for ${fields}`);
      }

      if (error.code === 'P2025') {
        throw new NotFoundException('Target record was not found');
      }
    }

    throw error;
  }

  private fromDbUserRole(role: UserRole): 'admin' | 'member' {
    return role === UserRole.ADMIN ? 'admin' : 'member';
  }

  private toDbUserRole(role: 'admin' | 'member') {
    return role === 'admin' ? UserRole.ADMIN : UserRole.MEMBER;
  }

  private fromDbUserStatus(status: UserStatus): 'active' | 'suspended' | 'banned' {
    switch (status) {
      case UserStatus.SUSPENDED: return 'suspended';
      case UserStatus.BANNED: return 'banned';
      default: return 'active';
    }
  }

  private toDbUserStatus(status: 'active' | 'suspended' | 'banned') {
    switch (status) {
      case 'suspended': return UserStatus.SUSPENDED;
      case 'banned': return UserStatus.BANNED;
      default: return UserStatus.ACTIVE;
    }
  }

  private fromDbSubscriptionStatus(
    status: SubscriptionStatus,
  ): 'active' | 'expired' | 'paused' | 'canceled' {
    switch (status) {
      case SubscriptionStatus.EXPIRED: return 'expired';
      case SubscriptionStatus.PAUSED: return 'paused';
      case SubscriptionStatus.CANCELED: return 'canceled';
      default: return 'active';
    }
  }

  private toDbSubscriptionStatus(status: 'active' | 'expired' | 'paused' | 'canceled') {
    switch (status) {
      case 'expired': return SubscriptionStatus.EXPIRED;
      case 'paused': return SubscriptionStatus.PAUSED;
      case 'canceled': return SubscriptionStatus.CANCELED;
      default: return SubscriptionStatus.ACTIVE;
    }
  }

  private fromDbTrafficPackStatus(status: TrafficPackStatus): 'active' | 'exhausted' | 'expired' {
    switch (status) {
      case TrafficPackStatus.EXHAUSTED: return 'exhausted';
      case TrafficPackStatus.EXPIRED: return 'expired';
      default: return 'active';
    }
  }

  private fromDbOrderStatus(status: OrderStatus): 'pending' | 'applied' | 'void' {
    switch (status) {
      case OrderStatus.VOID: return 'void';
      case OrderStatus.APPLIED: return 'applied';
      default: return 'pending';
    }
  }

  private fromDbOrderKind(kind: OrderKind): 'renewal' | 'traffic_pack' | 'manual_credit' {
    switch (kind) {
      case OrderKind.TRAFFIC_PACK: return 'traffic_pack';
      case OrderKind.MANUAL_CREDIT: return 'manual_credit';
      default: return 'renewal';
    }
  }

  private toDbOrderKind(kind: 'renewal' | 'traffic_pack' | 'manual_credit') {
    switch (kind) {
      case 'traffic_pack': return OrderKind.TRAFFIC_PACK;
      case 'manual_credit': return OrderKind.MANUAL_CREDIT;
      default: return OrderKind.RENEWAL;
    }
  }

  private fromDbRedemptionCodeKind(kind: RedemptionCodeKind): 'plan' | 'traffic_pack' {
    return kind === RedemptionCodeKind.TRAFFIC_PACK ? 'traffic_pack' : 'plan';
  }

  private toDbRedemptionCodeKind(kind: 'plan' | 'traffic_pack') {
    return kind === 'traffic_pack' ? RedemptionCodeKind.TRAFFIC_PACK : RedemptionCodeKind.PLAN;
  }

  private fromDbRedemptionCodeStatus(
    status: RedemptionCodeStatus,
  ): 'active' | 'redeemed' | 'void' | 'expired' {
    switch (status) {
      case RedemptionCodeStatus.REDEEMED: return 'redeemed';
      case RedemptionCodeStatus.VOID: return 'void';
      case RedemptionCodeStatus.EXPIRED: return 'expired';
      default: return 'active';
    }
  }

  private toDbRedemptionCodeStatus(status: 'active' | 'void') {
    return status === 'void' ? RedemptionCodeStatus.VOID : RedemptionCodeStatus.ACTIVE;
  }

  private withDefinedValues<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as Partial<T>;
  }

  async cleanupOldData(retentionDays: number) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const [snapshots, events] = await Promise.all([
      this.prisma.onlineSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
      this.prisma.authEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ]);

    return { deletedSnapshots: snapshots.count, deletedAuthEvents: events.count };
  }
}
