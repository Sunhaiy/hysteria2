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
        nodeGroup: true;
      };
      orderBy: { priority: 'asc' };
    };
  };
}>;

type NodeGroupWithNodes = Prisma.NodeGroupGetPayload<{
  include: {
    nodes: true;
  };
}>;

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: {
    user: true;
    plan: true;
    nodeGroup: true;
    trafficPacks: true;
  };
}>;

type OrderWithRelations = Prisma.ManualOrderGetPayload<{
  include: {
    user: true;
    processedBy: true;
  };
}>;

@Injectable()
export class ControlPlaneStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async health() {
    const [users, plans, subscriptions, nodes, nodeGroups] =
      await this.prisma.$transaction([
        this.prisma.user.count(),
        this.prisma.plan.count(),
        this.prisma.subscription.count(),
        this.prisma.node.count(),
        this.prisma.nodeGroup.count(),
      ]);

    return {
      users,
      plans,
      subscriptions,
      nodes,
      nodeGroups,
    };
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
    role: 'admin' | 'member';
    status: 'active' | 'suspended' | 'banned';
    notes?: string;
    initialPlanId?: string;
    initialNodeGroupId?: string;
  }) {
    try {
      const token = this.generateAccessToken();
      const user = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            passwordHash: input.passwordHash,
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
          const { plan, nodeGroupId } = await this.resolvePlanProvisioning(tx, {
            planId: input.initialPlanId,
            requestedNodeGroupId: input.initialNodeGroupId,
          });

          const subscription = await tx.subscription.create({
            data: {
              userId: createdUser.id,
              planId: plan.id,
              nodeGroupId,
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

        return {
          createdUser,
          accessToken,
          createdSubscriptionId,
        };
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
          include: { nodeGroup: true },
          orderBy: { priority: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
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
            include: { nodeGroup: true },
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
            include: { nodeGroup: true },
            orderBy: { priority: 'asc' },
          },
        },
      });

      return this.presentPlan(plan);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getNodeGroups() {
    const groups = await this.prisma.nodeGroup.findMany({
      include: {
        nodes: {
          orderBy: { label: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((group) => this.presentNodeGroup(group));
  }

  async createNodeGroup(input: {
    slug: string;
    name: string;
    description?: string;
    active?: boolean;
  }) {
    try {
      const group = await this.prisma.nodeGroup.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          active: input.active ?? true,
        },
        include: {
          nodes: true,
        },
      });

      return this.presentNodeGroup(group);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchNodeGroup(
    nodeGroupId: string,
    input: {
      slug?: string;
      name?: string;
      description?: string;
      active?: boolean;
    },
  ) {
    try {
      const group = await this.prisma.nodeGroup.update({
        where: { id: nodeGroupId },
        data: this.withDefinedValues({
          slug: input.slug,
          name: input.name,
          description: input.description,
          active: input.active,
        }),
        include: {
          nodes: true,
        },
      });

      return this.presentNodeGroup(group);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getPlanBindings() {
    const bindings = await this.prisma.planBinding.findMany({
      include: {
        plan: true,
        nodeGroup: true,
      },
      orderBy: [{ planId: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
    });

    return bindings.map((binding) => ({
      id: binding.id,
      planId: binding.planId,
      planName: binding.plan.name,
      nodeGroupId: binding.nodeGroupId,
      nodeGroupName: binding.nodeGroup.name,
      priority: binding.priority,
      createdAt: binding.createdAt.toISOString(),
    }));
  }

  async createPlanBinding(input: {
    planId: string;
    nodeGroupId: string;
    priority?: number;
  }) {
    try {
      const binding = await this.prisma.planBinding.create({
        data: {
          planId: input.planId,
          nodeGroupId: input.nodeGroupId,
          priority: input.priority ?? 0,
        },
        include: {
          plan: true,
          nodeGroup: true,
        },
      });

      return {
        id: binding.id,
        planId: binding.planId,
        planName: binding.plan.name,
        nodeGroupId: binding.nodeGroupId,
        nodeGroupName: binding.nodeGroup.name,
        priority: binding.priority,
        createdAt: binding.createdAt.toISOString(),
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchPlanBinding(
    bindingId: string,
    input: {
      nodeGroupId?: string;
      priority?: number;
    },
  ) {
    try {
      const binding = await this.prisma.planBinding.update({
        where: { id: bindingId },
        data: this.withDefinedValues({
          nodeGroupId: input.nodeGroupId,
          priority: input.priority,
        }),
        include: {
          plan: true,
          nodeGroup: true,
        },
      });

      return {
        id: binding.id,
        planId: binding.planId,
        planName: binding.plan.name,
        nodeGroupId: binding.nodeGroupId,
        nodeGroupName: binding.nodeGroup.name,
        priority: binding.priority,
        createdAt: binding.createdAt.toISOString(),
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getSubscriptions() {
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();

    const subscriptions = await this.prisma.subscription.findMany({
      include: {
        user: true,
        plan: true,
        nodeGroup: true,
        trafficPacks: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      subscriptions.map((subscription) =>
        this.presentSubscription(subscription),
      ),
    );
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
    nodeGroupId?: string;
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
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
        },
      },
    });
    if (openSubscription) {
      throw new ConflictException(
        'User already has an active or paused subscription',
      );
    }

    const { plan, nodeGroupId } = await this.resolvePlanProvisioning(
      this.prisma,
      {
      planId: input.planId,
      requestedNodeGroupId: input.nodeGroupId,
      },
    );

    const endsAt = this.buildSubscriptionEndDate(startsAt, plan.durationDays);

    try {
      const subscription = await this.prisma.subscription.create({
        data: {
          userId: input.userId,
          planId: input.planId,
          nodeGroupId,
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
        include: {
          user: true,
          plan: true,
          nodeGroup: true,
          trafficPacks: true,
        },
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
      nodeGroupId?: string;
      includedTrafficBytes?: number;
      bonusTrafficBytes?: number;
      consumedTrafficBytes?: number;
      speedUpMbpsSnapshot?: number;
      speedDownMbpsSnapshot?: number;
      deviceLimitSnapshot?: number;
    },
  ) {
    const subscription = await this.mustGetSubscriptionRecord(subscriptionId);

    if (input.nodeGroupId) {
      const allowed = await this.prisma.planBinding.findFirst({
        where: {
          planId: subscription.planId,
          nodeGroupId: input.nodeGroupId,
        },
      });
      if (!allowed) {
        throw new BadRequestException(
          'Selected node group is not allowed for this subscription plan',
        );
      }
    }

    try {
      const updated = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: this.withDefinedValues({
          status: input.status
            ? this.toDbSubscriptionStatus(input.status)
            : undefined,
          endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
          nodeGroupId: input.nodeGroupId,
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
        include: {
          user: true,
          plan: true,
          nodeGroup: true,
          trafficPacks: true,
        },
      });

      return this.presentSubscription(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getNodes() {
    const nodes = await this.prisma.node.findMany({
      include: {
        nodeGroup: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(nodes.map((node) => this.presentNode(node)));
  }

  async getNodeById(nodeId: string) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: {
        nodeGroup: true,
      },
    });

    return node ? this.presentNode(node) : undefined;
  }

  async createNode(input: {
    nodeGroupId: string;
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
    await this.mustGetNodeGroupRecord(input.nodeGroupId);
    try {
      const node = await this.prisma.node.create({
        data: {
          nodeGroupId: input.nodeGroupId,
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
        include: {
          nodeGroup: true,
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
      nodeGroupId?: string;
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
    if (input.nodeGroupId) {
      await this.mustGetNodeGroupRecord(input.nodeGroupId);
    }

    try {
      const node = await this.prisma.node.update({
        where: { id: nodeId },
        data: this.withDefinedValues({
          nodeGroupId: input.nodeGroupId,
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
        include: {
          nodeGroup: true,
        },
      });

      return this.presentNode(node);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getUsageForUser(userId: string) {
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();

    const subscription =
      await this.mustGetActiveSubscriptionRecordForUser(userId);
    const packs = await this.prisma.trafficPack.findMany({
      where: {
        subscriptionId: subscription.id,
        status: TrafficPackStatus.ACTIVE,
      },
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
    const packRemaining = packs.reduce(
      (sum, pack) => sum + Number(pack.remainingBytes),
      0,
    );
    const recent = await this.prisma.usageRollup.findMany({
      where: { userId },
      orderBy: { bucketStart: 'desc' },
      take: 12,
      include: {
        node: true,
      },
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
    const subscription =
      await this.mustGetActiveSubscriptionRecordForUser(userId);
    const plan = await this.mustGetPlanRecord(subscription.planId);
    const node = await this.mustGetPreferredNodeForSubscription(subscription);
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
      subscription: await this.presentSubscription({
        ...subscription,
        user,
        plan,
        nodeGroup: await this.mustGetNodeGroupRecord(subscription.nodeGroupId),
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
    const subscription =
      await this.mustGetActiveSubscriptionRecordForUser(userId);
    const token = await this.mustGetAccessTokenByUser(userId);
    const node = await this.mustGetPreferredNodeForSubscription(subscription);
    const usage = await this.getUsageForUser(userId);

    return {
      user: this.presentUser({
        ...user,
        accessTokens: [token],
      }),
      subscription: await this.presentSubscription({
        ...subscription,
        user,
        plan: await this.mustGetPlanRecord(subscription.planId),
        nodeGroup: await this.mustGetNodeGroupRecord(subscription.nodeGroupId),
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
    processedById: string;
    kind: 'renewal' | 'traffic_pack' | 'manual_credit';
    amountCents: number;
    durationDays?: number;
    trafficBytes?: number;
    note?: string;
  }) {
    await this.mustGetUserRecord(input.userId);
    await this.mustGetUserRecord(input.processedById);

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId: input.userId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
        },
      },
      orderBy: { endsAt: 'desc' },
    });

    if ((input.durationDays || input.trafficBytes) && !subscription) {
      throw new BadRequestException(
        'Manual credit requires an existing active or paused subscription',
      );
    }

    const timestamp = new Date();

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const createdOrder = await tx.manualOrder.create({
          data: {
            userId: input.userId,
            processedById: input.processedById,
            status: OrderStatus.APPLIED,
            kind: this.toDbOrderKind(input.kind),
            amountCents: input.amountCents,
            durationDays: input.durationDays,
            trafficBytes:
              input.trafficBytes !== undefined
                ? BigInt(input.trafficBytes)
                : undefined,
            note: input.note,
            processedAt: timestamp,
          },
          include: {
            user: true,
            processedBy: true,
          },
        });

        if (subscription) {
          if (input.durationDays) {
            const extensionBase =
              subscription.endsAt.getTime() > timestamp.getTime()
                ? new Date(subscription.endsAt)
                : new Date(timestamp);
            extensionBase.setUTCDate(
              extensionBase.getUTCDate() + input.durationDays,
            );

            await tx.subscription.update({
              where: { id: subscription.id },
              data: { endsAt: extensionBase },
            });
          }

          if (input.trafficBytes) {
            await tx.trafficPack.create({
              data: {
                userId: subscription.userId,
                subscriptionId: subscription.id,
                label: input.note || 'Manual top-up',
                totalBytes: BigInt(input.trafficBytes),
                remainingBytes: BigInt(input.trafficBytes),
                status: TrafficPackStatus.ACTIVE,
                expiresAt: subscription.endsAt,
              },
            });
          }
        }

        return createdOrder;
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
    return this.prisma.authEvent.create({
      data: event,
    });
  }

  async markTokenUsed(accessTokenId: string) {
    await this.prisma.accessToken.update({
      where: { id: accessTokenId },
      data: {
        lastUsedAt: new Date(),
      },
    });
  }

  async findAccessToken(tokenValue: string) {
    return this.prisma.accessToken.findFirst({
      where: {
        token: tokenValue,
        revokedAt: null,
      },
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
      where: {
        token: input.tokenValue,
        revokedAt: null,
      },
    });
    if (!token) {
      return this.rejectAuth('token_not_found', input);
    }

    const user = await this.mustGetUserRecord(token.userId);
    const node = await this.prisma.node.findUnique({
      where: { id: input.nodeId },
    });

    if (!node || !node.active) {
      return this.rejectAuth(
        'node_unavailable',
        input,
        token.id,
        user.id,
        node?.id,
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      return this.rejectAuth(
        'user_not_active',
        input,
        token.id,
        user.id,
        node.id,
      );
    }

    const subscription = await this.getActiveSubscriptionForUser(user.id);
    if (!subscription) {
      return this.rejectAuth(
        'subscription_missing',
        input,
        token.id,
        user.id,
        node.id,
      );
    }

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      return this.rejectAuth(
        'subscription_not_active',
        input,
        token.id,
        user.id,
        node.id,
      );
    }

    if (subscription.endsAt.getTime() <= Date.now()) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.EXPIRED },
      });
      return this.rejectAuth(
        'subscription_expired',
        input,
        token.id,
        user.id,
        node.id,
      );
    }

    if (subscription.nodeGroupId !== node.nodeGroupId) {
      return this.rejectAuth(
        'node_group_forbidden',
        input,
        token.id,
        user.id,
        node.id,
      );
    }

    const usage = await this.getUsageForUser(user.id);
    if (usage.totalRemainingBytes <= 0) {
      return this.rejectAuth(
        'traffic_exhausted',
        input,
        token.id,
        user.id,
        node.id,
      );
    }

    const onlineCount = await this.getCurrentOnlineCount(user.id);
    if (onlineCount >= subscription.deviceLimitSnapshot) {
      return this.rejectAuth(
        'device_limit_exceeded',
        input,
        token.id,
        user.id,
        node.id,
      );
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

    return {
      ok: true as const,
      id: user.id,
    };
  }

  async applyTrafficSnapshot(
    nodeId: string,
    trafficMap: Record<string, { tx: number; rx: number }>,
  ) {
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();

    const impactedUsers = new Set<string>();

    await this.prisma.$transaction(async (tx) => {
      for (const [userId, counters] of Object.entries(trafficMap)) {
        const subscription = await tx.subscription.findFirst({
          where: {
            userId,
            status: SubscriptionStatus.ACTIVE,
            endsAt: { gt: new Date() },
          },
          orderBy: { endsAt: 'desc' },
        });

        if (!subscription) {
          continue;
        }

        impactedUsers.add(userId);
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
            where: {
              subscriptionId: subscription.id,
              status: TrafficPackStatus.ACTIVE,
            },
            orderBy: { createdAt: 'asc' },
          });

          for (const pack of packs) {
            if (remaining <= 0) {
              break;
            }

            const consume = Math.min(Number(pack.remainingBytes), remaining);
            const nextRemaining = Number(pack.remainingBytes) - consume;

            await tx.trafficPack.update({
              where: { id: pack.id },
              data: {
                remainingBytes: BigInt(nextRemaining),
                status:
                  nextRemaining <= 0
                    ? TrafficPackStatus.EXHAUSTED
                    : TrafficPackStatus.ACTIVE,
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
      }
    });

    return [...impactedUsers];
  }

  async applyOnlineSnapshot(nodeId: string, onlineMap: Record<string, number>) {
    const previous = await this.prisma.onlineSnapshot.findMany({
      where: { nodeId },
      orderBy: { capturedAt: 'desc' },
      include: {
        user: true,
      },
    });

    const latestUsers = new Set<string>();
    const latestByUser = new Map<string, number>();
    for (const snapshot of previous) {
      if (!latestUsers.has(snapshot.userId)) {
        latestUsers.add(snapshot.userId);
        latestByUser.set(snapshot.userId, snapshot.concurrentClients);
      }
    }

    const mergedUsers = new Set([
      ...Object.keys(onlineMap),
      ...latestByUser.keys(),
    ]);
    if (mergedUsers.size === 0) {
      return;
    }

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
    if (user.status !== UserStatus.ACTIVE) {
      return true;
    }

    const subscription = await this.getActiveSubscriptionForUser(userId);
    if (!subscription) {
      return true;
    }

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      return true;
    }

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
    if (!subscription) {
      return [];
    }

    const nodes = await this.prisma.node.findMany({
      where: {
        nodeGroupId: subscription.nodeGroupId,
        active: true,
      },
      select: { id: true },
    });

    return nodes.map((node) => node.id);
  }

  async getManualOrders() {
    const orders = await this.prisma.manualOrder.findMany({
      include: {
        user: true,
        processedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => this.presentManualOrder(order));
  }

  async getManualOrdersForUser(userId: string) {
    const orders = await this.prisma.manualOrder.findMany({
      where: { userId },
      include: {
        user: true,
        processedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => this.presentManualOrder(order));
  }

  async getAuthEvents(limit = 20) {
    const events = await this.prisma.authEvent.findMany({
      include: {
        user: true,
        accessToken: true,
        node: true,
      },
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
      include: {
        user: true,
        node: true,
      },
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
      include: {
        user: true,
        node: true,
      },
      orderBy: { capturedAt: 'desc' },
      take: 500,
    });

    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      const key = `${snapshot.userId}:${snapshot.nodeId}`;
      if (!latest.has(key)) {
        latest.set(key, snapshot);
      }
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
    return {
      ...this.presentUser(user),
      passwordHash: user.passwordHash,
    };
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
      boundNodeGroups: plan.bindings.map((binding) => binding.nodeGroup.name),
      bindings: plan.bindings.map((binding) => ({
        id: binding.id,
        nodeGroupId: binding.nodeGroupId,
        nodeGroupName: binding.nodeGroup.name,
        priority: binding.priority,
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

  private presentNodeGroup(group: NodeGroupWithNodes) {
    return {
      id: group.id,
      slug: group.slug,
      name: group.name,
      description: group.description,
      active: group.active,
      nodeCount: group.nodes.length,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  private async presentSubscription(subscription: SubscriptionWithRelations) {
    const remaining = await this.getRemainingTrafficForSubscription(
      subscription.id,
      subscription.includedTrafficBytes,
      subscription.bonusTrafficBytes,
      subscription.consumedTrafficBytes,
    );

    return {
      id: subscription.id,
      userId: subscription.userId,
      userEmail: subscription.user.email,
      userDisplayName: subscription.user.displayName,
      planId: subscription.planId,
      planName: subscription.plan.name,
      nodeGroupId: subscription.nodeGroupId,
      nodeGroupName: subscription.nodeGroup.name,
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

  private async presentNode(
    node: Prisma.NodeGetPayload<{ include: { nodeGroup: true } }>,
  ) {
    const snapshots = await this.prisma.onlineSnapshot.findMany({
      where: { nodeId: node.id },
      orderBy: { capturedAt: 'desc' },
      take: 200,
    });
    const latestUsers = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (!latestUsers.has(snapshot.userId)) {
        latestUsers.set(snapshot.userId, snapshot.concurrentClients);
      }
    }

    return {
      id: node.id,
      nodeGroupId: node.nodeGroupId,
      groupName: node.nodeGroup.name,
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
      concurrentUsers: [...latestUsers.values()].filter((value) => value > 0)
        .length,
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

  private async getRemainingTrafficForSubscription(
    subscriptionId: string,
    includedTrafficBytes: bigint,
    bonusTrafficBytes: bigint,
    consumedTrafficBytes: bigint,
  ) {
    const packs = await this.prisma.trafficPack.findMany({
      where: {
        subscriptionId,
        status: TrafficPackStatus.ACTIVE,
      },
    });

    const baseRemaining = Math.max(
      Number(includedTrafficBytes + bonusTrafficBytes - consumedTrafficBytes),
      0,
    );
    const packRemaining = packs.reduce(
      (sum, pack) => sum + Number(pack.remainingBytes),
      0,
    );

    return baseRemaining + packRemaining;
  }

  private async mustGetUserRecord(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(`Unknown user: ${userId}`);
    }
    return user;
  }

  private async mustGetPlanRecord(planId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });
    if (!plan) {
      throw new NotFoundException(`Unknown plan: ${planId}`);
    }
    return plan;
  }

  private async mustGetNodeGroupRecord(nodeGroupId: string) {
    const nodeGroup = await this.prisma.nodeGroup.findUnique({
      where: { id: nodeGroupId },
    });
    if (!nodeGroup) {
      throw new NotFoundException(`Unknown node group: ${nodeGroupId}`);
    }
    return nodeGroup;
  }

  private async mustGetSubscriptionRecord(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      throw new NotFoundException(`Unknown subscription: ${subscriptionId}`);
    }
    return subscription;
  }

  private async mustGetActiveSubscriptionRecordForUser(userId: string) {
    const subscription = await this.getActiveSubscriptionForUser(userId);
    if (!subscription) {
      throw new NotFoundException(`No active subscription for user: ${userId}`);
    }
    return subscription;
  }

  private async mustGetAccessTokenByUser(userId: string) {
    const token = await this.prisma.accessToken.findFirst({
      where: {
        userId,
        revokedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!token) {
      throw new NotFoundException(`No access token for user: ${userId}`);
    }
    return token;
  }

  private async mustGetPreferredNodeForSubscription(
    subscription: Prisma.SubscriptionGetPayload<object>,
  ) {
    const node = await this.prisma.node.findFirst({
      where: {
        nodeGroupId: subscription.nodeGroupId,
        active: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!node) {
      throw new NotFoundException(
        `No active node for subscription: ${subscription.id}`,
      );
    }
    return node;
  }

  private async expireOverdueSubscriptions() {
    await this.prisma.subscription.updateMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endsAt: { lte: new Date() },
      },
      data: {
        status: SubscriptionStatus.EXPIRED,
      },
    });
  }

  private async expireTrafficPacks() {
    await this.prisma.trafficPack.updateMany({
      where: {
        status: TrafficPackStatus.ACTIVE,
        expiresAt: {
          lte: new Date(),
        },
      },
      data: {
        status: TrafficPackStatus.EXPIRED,
      },
    });
  }

  private generateAccessToken() {
    return `hy2_${randomBytes(12).toString('hex')}`;
  }

  private buildSubscriptionEndDate(startsAt: Date, durationDays: number) {
    const endsAt = new Date(startsAt);
    endsAt.setUTCDate(endsAt.getUTCDate() + durationDays);
    return endsAt;
  }

  private async resolvePlanProvisioning(
    tx: Prisma.TransactionClient | PrismaService,
    input: {
      planId: string;
      requestedNodeGroupId?: string;
    },
  ) {
    const plan = await tx.plan.findUnique({
      where: { id: input.planId },
    });
    if (!plan) {
      throw new NotFoundException(`Unknown plan: ${input.planId}`);
    }

    const bindings = await tx.planBinding.findMany({
      where: { planId: input.planId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    const nodeGroupId =
      input.requestedNodeGroupId ?? bindings[0]?.nodeGroupId ?? null;
    if (!nodeGroupId) {
      throw new BadRequestException(
        'Plan has no bound node group; create a plan binding first',
      );
    }

    const bindingAllowed = bindings.some(
      (binding) => binding.nodeGroupId === nodeGroupId,
    );
    if (!bindingAllowed) {
      throw new BadRequestException(
        'Selected node group is not allowed for this plan',
      );
    }

    const nodeGroup = await tx.nodeGroup.findUnique({
      where: { id: nodeGroupId },
    });
    if (!nodeGroup) {
      throw new NotFoundException(`Unknown node group: ${nodeGroupId}`);
    }

    return {
      plan,
      nodeGroupId,
      nodeGroup,
    };
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

  private fromDbUserStatus(
    status: UserStatus,
  ): 'active' | 'suspended' | 'banned' {
    switch (status) {
      case UserStatus.SUSPENDED:
        return 'suspended';
      case UserStatus.BANNED:
        return 'banned';
      default:
        return 'active';
    }
  }

  private toDbUserStatus(status: 'active' | 'suspended' | 'banned') {
    switch (status) {
      case 'suspended':
        return UserStatus.SUSPENDED;
      case 'banned':
        return UserStatus.BANNED;
      default:
        return UserStatus.ACTIVE;
    }
  }

  private fromDbSubscriptionStatus(
    status: SubscriptionStatus,
  ): 'active' | 'expired' | 'paused' | 'canceled' {
    switch (status) {
      case SubscriptionStatus.EXPIRED:
        return 'expired';
      case SubscriptionStatus.PAUSED:
        return 'paused';
      case SubscriptionStatus.CANCELED:
        return 'canceled';
      default:
        return 'active';
    }
  }

  private toDbSubscriptionStatus(
    status: 'active' | 'expired' | 'paused' | 'canceled',
  ) {
    switch (status) {
      case 'expired':
        return SubscriptionStatus.EXPIRED;
      case 'paused':
        return SubscriptionStatus.PAUSED;
      case 'canceled':
        return SubscriptionStatus.CANCELED;
      default:
        return SubscriptionStatus.ACTIVE;
    }
  }

  private fromDbTrafficPackStatus(
    status: TrafficPackStatus,
  ): 'active' | 'exhausted' | 'expired' {
    switch (status) {
      case TrafficPackStatus.EXHAUSTED:
        return 'exhausted';
      case TrafficPackStatus.EXPIRED:
        return 'expired';
      default:
        return 'active';
    }
  }

  private fromDbOrderStatus(
    status: OrderStatus,
  ): 'pending' | 'applied' | 'void' {
    switch (status) {
      case OrderStatus.VOID:
        return 'void';
      case OrderStatus.APPLIED:
        return 'applied';
      default:
        return 'pending';
    }
  }

  private fromDbOrderKind(
    kind: OrderKind,
  ): 'renewal' | 'traffic_pack' | 'manual_credit' {
    switch (kind) {
      case OrderKind.TRAFFIC_PACK:
        return 'traffic_pack';
      case OrderKind.MANUAL_CREDIT:
        return 'manual_credit';
      default:
        return 'renewal';
    }
  }

  private toDbOrderKind(kind: 'renewal' | 'traffic_pack' | 'manual_credit') {
    switch (kind) {
      case 'traffic_pack':
        return OrderKind.TRAFFIC_PACK;
      case 'manual_credit':
        return OrderKind.MANUAL_CREDIT;
      default:
        return OrderKind.RENEWAL;
    }
  }

  private withDefinedValues<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as Partial<T>;
  }
}
