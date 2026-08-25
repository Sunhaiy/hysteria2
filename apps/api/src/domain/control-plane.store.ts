import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingPeriod,
  NodeProtocol,
  OrderKind,
  OrderSource,
  OrderStatus,
  Plan,
  Prisma,
  RedemptionCodeKind,
  RedemptionPlanMode,
  RedemptionCodeStatus,
  SubscriptionStatus,
  TrafficPackStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';
import { OnlinePresenceService } from './online-presence.service';
import { resolvePlanRedemptionWindow } from '../commerce/plan-redemption-policy';

const bytesInGiB = 1024 * 1024 * 1024;
const reconnectGraceMs = 2 * 60_000;
const rejectedAuthDedupeMs = 15 * 60_000;

function remoteHost(remoteAddr?: string) {
  if (!remoteAddr) return undefined;

  const bracketedIpv6 = remoteAddr.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketedIpv6) return bracketedIpv6[1];

  const firstColon = remoteAddr.indexOf(':');
  const lastColon = remoteAddr.lastIndexOf(':');
  if (firstColon === lastColon && lastColon > 0) {
    return remoteAddr.slice(0, lastColon);
  }

  return remoteAddr;
}

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
    trafficPackProduct: true;
  };
}>;

type RedemptionCodeWithRelations = Prisma.RedemptionCodeGetPayload<{
  include: {
    plan: true;
    catalogOffer: {
      include: { product: { include: { legacyPlan: true } } };
    };
    createdBy: true;
    redeemedBy: true;
    trafficPackProduct: true;
  };
}>;

type CdkKind = 'plan' | 'traffic_pack' | 'balance' | 'discount';

export interface ManualOrderQuery extends PageQuery {
  q?: string;
  status?: string;
  source?: string;
}

export interface RedemptionCodeQuery extends PageQuery {
  q?: string;
  status?: string;
  kind?: string;
}

@Injectable()
export class ControlPlaneStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: OnlinePresenceService,
  ) {}

  async health() {
    const [users, plans, subscriptions, nodes] = await this.prisma.$transaction(
      [
        this.prisma.user.count(),
        this.prisma.plan.count(),
        this.prisma.subscription.count(),
        this.prisma.node.count(),
      ],
    );

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

  async getSessionIdentity(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        sessionVersion: true,
      },
    });
    return user
      ? {
          ...user,
          role: this.fromDbUserRole(user.role),
          status: this.fromDbUserStatus(user.status),
        }
      : null;
  }

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
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
            role: this.toDbUserRole(input.role),
            status: this.toDbUserStatus(input.status),
            notes: input.notes,
          },
        });
        const accessAccount = await tx.accessAccount.create({
          data: { userId: createdUser.id },
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
          const offer = await tx.planOffer.findFirst({
            where: { planId: plan.id, active: true, archivedAt: null },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          });
          const endsAt = this.buildSubscriptionEndDate(
            startsAt,
            offer?.legacyDurationDays ?? plan.durationDays,
          );

          const subscription = await tx.subscription.create({
            data: {
              userId: createdUser.id,
              planId: plan.id,
              nodeId,
              accessAccountId: accessAccount.id,
              planOfferId: offer?.id,
              status: SubscriptionStatus.ACTIVE,
              startsAt,
              endsAt,
              includedTrafficBytes: plan.trafficBytes,
              bonusTrafficBytes: BigInt(0),
              consumedTrafficBytes: BigInt(0),
              speedUpMbpsSnapshot: plan.speedUpMbps,
              speedDownMbpsSnapshot: plan.speedDownMbps,
              deviceLimitSnapshot: plan.deviceLimit,
              cycles: {
                create: {
                  startsAt,
                  endsAt,
                  grantedBytes: plan.trafficBytes,
                  legacy: offer?.billingPeriod === 'LEGACY',
                },
              },
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
          sessionVersion:
            input.passwordHash || input.role || input.status
              ? { increment: 1 }
              : undefined,
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

  async issuePasswordResetToken(input: {
    userId: string;
    createdById: string | null;
    tokenHash: string;
    expiresAt: Date;
  }) {
    await this.mustGetUserRecord(input.userId);
    return this.prisma.$transaction(async (tx) => {
      const issuedAt = new Date();
      await tx.passwordResetToken.updateMany({
        where: { userId: input.userId, usedAt: null },
        data: { usedAt: issuedAt },
      });
      const token = await tx.passwordResetToken.create({
        data: input,
        select: { id: true, expiresAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.createdById,
          action: 'identity.password_reset.issued',
          targetType: 'user',
          targetId: input.userId,
          metadata: { tokenId: token.id, expiresAt: token.expiresAt },
        },
      });
      return token;
    });
  }

  async consumePasswordResetToken(tokenHash: string, passwordHash: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const token = await tx.passwordResetToken.findUnique({
          where: { tokenHash },
          select: { id: true, userId: true },
        });
        if (!token) return false;

        const consumedAt = new Date();
        const consumed = await tx.passwordResetToken.updateMany({
          where: {
            id: token.id,
            usedAt: null,
            expiresAt: { gt: consumedAt },
          },
          data: { usedAt: consumedAt },
        });
        if (consumed.count !== 1) return false;

        await tx.user.update({
          where: { id: token.userId },
          data: {
            passwordHash,
            sessionVersion: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'identity.password_reset.completed',
            targetType: 'user',
            targetId: token.userId,
            metadata: { tokenId: token.id },
          },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
          accessProfile: {
            create: {
              slug: input.slug,
              name: `${input.name} 访问配置`,
              description: input.description,
              active: input.active,
              speedUpMbps: input.speedUpMbps,
              speedDownMbps: input.speedDownMbps,
              deviceLimit: input.deviceLimit,
            },
          },
          offers: {
            create: {
              slug: `${input.slug}-legacy`,
              name: `${input.durationDays} 天`,
              active: input.active,
              isDefault: true,
              billingPeriod: 'LEGACY',
              legacyDurationDays: input.durationDays,
              priceCents: input.priceCents,
            },
          },
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

      if (plan.accessProfileId) {
        await this.prisma.accessProfile.update({
          where: { id: plan.accessProfileId },
          data: this.withDefinedValues({
            slug: input.slug,
            name: input.name ? `${input.name} 访问配置` : undefined,
            description: input.description,
            active: input.active,
            speedUpMbps: input.speedUpMbps,
            speedDownMbps: input.speedDownMbps,
            deviceLimit: input.deviceLimit,
          }),
        });
      }

      await this.prisma.planOffer.updateMany({
        where: {
          planId,
          billingPeriod: BillingPeriod.LEGACY,
          archivedAt: null,
        },
        data: this.withDefinedValues({
          slug: input.slug ? `${input.slug}-legacy` : undefined,
          name:
            input.durationDays !== undefined
              ? `${input.durationDays} 天`
              : undefined,
          active: input.active,
          legacyDurationDays: input.durationDays,
          priceCents: input.priceCents,
        }),
      });

      return this.presentPlan(plan);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getTrafficPackProducts() {
    const products = await this.prisma.trafficPackProduct.findMany({
      include: { accessProfile: true },
      orderBy: [
        { active: 'desc' },
        { priceCents: 'asc' },
        { createdAt: 'asc' },
      ],
    });
    return products.map((product) => this.presentTrafficPackProduct(product));
  }

  async getPurchasableTrafficPackProducts() {
    const products = await this.prisma.trafficPackProduct.findMany({
      where: {
        active: true,
        archivedAt: null,
        validityDays: { not: null },
        accessProfile: {
          active: true,
          nodeBindings: { some: { node: { active: true } } },
        },
      },
      include: { accessProfile: true },
      orderBy: [{ priceCents: 'asc' }, { createdAt: 'asc' }],
    });
    return products.map((product) => this.presentTrafficPackProduct(product));
  }

  async createTrafficPackProduct(input: {
    slug: string;
    name: string;
    description: string;
    active: boolean;
    trafficBytes: number;
    validityDays: number;
    accessProfileId: string;
    priceCents: number;
    accent: string;
  }) {
    try {
      const product = await this.prisma.trafficPackProduct.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          active: input.active,
          trafficBytes: BigInt(input.trafficBytes),
          validityDays: input.validityDays,
          accessProfileId: input.accessProfileId,
          priceCents: input.priceCents,
          accent: input.accent,
        },
      });
      return this.presentTrafficPackProduct(product);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchTrafficPackProduct(
    productId: string,
    input: {
      slug?: string;
      name?: string;
      description?: string;
      active?: boolean;
      trafficBytes?: number;
      validityDays?: number | null;
      accessProfileId?: string;
      priceCents?: number;
      accent?: string;
    },
  ) {
    try {
      const product = await this.prisma.trafficPackProduct.update({
        where: { id: productId },
        data: this.withDefinedValues({
          slug: input.slug,
          name: input.name,
          description: input.description,
          active: input.active,
          trafficBytes:
            input.trafficBytes !== undefined
              ? BigInt(input.trafficBytes)
              : undefined,
          validityDays: input.validityDays,
          accessProfileId: input.accessProfileId,
          priceCents: input.priceCents,
          accent: input.accent,
        }),
      });
      return this.presentTrafficPackProduct(product);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async archiveTrafficPackProduct(productId: string) {
    try {
      const product = await this.prisma.trafficPackProduct.update({
        where: { id: productId },
        data: { active: false, archivedAt: new Date() },
      });
      return this.presentTrafficPackProduct(product);
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
      const plan = await this.prisma.plan.findUnique({
        where: { id: input.planId },
        select: { accessProfileId: true },
      });
      if (plan?.accessProfileId) {
        await this.prisma.accessProfileNode.upsert({
          where: {
            accessProfileId_nodeId: {
              accessProfileId: plan.accessProfileId,
              nodeId: input.nodeId,
            },
          },
          create: {
            accessProfileId: plan.accessProfileId,
            nodeId: input.nodeId,
            priority: input.priority ?? 0,
          },
          update: { priority: input.priority ?? 0 },
        });
      }

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
      const binding = await this.prisma.planBinding.delete({
        where: { id: bindingId },
        include: { plan: true },
      });
      if (binding.plan.accessProfileId) {
        await this.prisma.accessProfileNode.deleteMany({
          where: {
            accessProfileId: binding.plan.accessProfileId,
            nodeId: binding.nodeId,
          },
        });
      }
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
        data: this.withDefinedValues({
          nodeId: input.nodeId,
          priority: input.priority,
        }),
        include: { plan: true, node: true },
      });
      if (binding.plan.accessProfileId) {
        await this.prisma.accessProfileNode.upsert({
          where: {
            accessProfileId_nodeId: {
              accessProfileId: binding.plan.accessProfileId,
              nodeId: binding.nodeId,
            },
          },
          create: {
            accessProfileId: binding.plan.accessProfileId,
            nodeId: binding.nodeId,
            priority: binding.priority,
          },
          update: { priority: binding.priority },
        });
      }

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
      throw new ConflictException(
        'User already has an active or paused subscription',
      );
    }

    const { plan, nodeId } = await this.resolvePlanNode(this.prisma, {
      planId: input.planId,
      requestedNodeId: input.nodeId,
    });
    const [account, offer] = await Promise.all([
      this.prisma.accessAccount.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId },
        update: {},
      }),
      this.prisma.planOffer.findFirst({
        where: { planId: plan.id, active: true, archivedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);

    const endsAt = this.buildSubscriptionEndDate(startsAt, plan.durationDays);

    try {
      const subscription = await this.prisma.subscription.create({
        data: {
          userId: input.userId,
          planId: input.planId,
          nodeId,
          accessAccountId: account.id,
          planOfferId: offer?.id,
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
          cycles: {
            create: {
              startsAt,
              endsAt,
              grantedBytes: plan.trafficBytes,
              legacy: offer?.billingPeriod === 'LEGACY',
            },
          },
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

    if (
      input.includedTrafficBytes !== undefined ||
      input.bonusTrafficBytes !== undefined ||
      input.consumedTrafficBytes !== undefined
    ) {
      throw new BadRequestException(
        'Use the quota-adjustments endpoint instead of replacing usage counters',
      );
    }

    if (input.nodeId) {
      const allowed = await this.prisma.planBinding.findFirst({
        where: { planId: subscription.planId, nodeId: input.nodeId },
      });
      if (!allowed) {
        throw new BadRequestException(
          'Selected node is not bound to this subscription plan',
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

  async getNodeProvisioningUsers(nodeId: string) {
    const now = new Date();
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
        user: { status: UserStatus.ACTIVE },
        plan: { bindings: { some: { nodeId } } },
      },
      include: {
        user: {
          include: {
            accessTokens: {
              where: { revokedAt: null },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
        trafficPacks: {
          where: {
            status: TrafficPackStatus.ACTIVE,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    });

    const users = new Map<string, { userId: string; id: string }>();
    for (const subscription of subscriptions) {
      const baseRemaining =
        subscription.includedTrafficBytes +
        subscription.bonusTrafficBytes -
        subscription.consumedTrafficBytes;
      const packRemaining = subscription.trafficPacks.reduce(
        (sum, pack) => sum + pack.remainingBytes,
        BigInt(0),
      );
      const token = subscription.user.accessTokens[0];
      if (token && baseRemaining + packRemaining > BigInt(0)) {
        users.set(subscription.userId, {
          userId: subscription.userId,
          id: token.vlessUuid,
        });
      }
    }

    return [...users.values()];
  }

  async getUsageForUser(userId: string) {
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();
    const now = new Date();
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
      },
      include: {
        cycles: {
          where: { startsAt: { lte: now }, endsAt: { gt: now } },
          take: 1,
        },
      },
      orderBy: { endsAt: 'desc' },
    });
    const packs = await this.prisma.trafficPack.findMany({
      where: {
        userId,
        status: TrafficPackStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });
    const cycle = subscription?.cycles[0];
    const baseRemaining = cycle
      ? Math.max(
          Number(
            cycle.grantedBytes + cycle.adjustmentBytes - cycle.consumedBytes,
          ),
          0,
        )
      : subscription
        ? Math.max(
            Number(
              subscription.includedTrafficBytes +
                subscription.bonusTrafficBytes -
                subscription.consumedTrafficBytes,
            ),
            0,
          )
        : 0;
    const packRemaining = packs.reduce(
      (sum, pack) => sum + Number(pack.remainingBytes),
      0,
    );
    const recent = await this.prisma.usageRollup.findMany({
      where: { userId },
      orderBy: { bucketStart: 'desc' },
      take: 12,
      include: { node: true },
    });

    return {
      subscriptionId: subscription?.id ?? null,
      consumedBytes: Number(
        cycle?.consumedBytes ?? subscription?.consumedTrafficBytes ?? 0,
      ),
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
    const now = new Date();
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
      },
      include: { user: true, plan: true, node: true, trafficPacks: true },
      orderBy: { endsAt: 'desc' },
    });
    const usage = await this.getUsageForUser(userId);
    const online = await this.presence.countForUser(userId);
    const packs = await this.prisma.trafficPack.findMany({
      where: { userId },
      include: {
        accessProfile: {
          include: {
            nodeBindings: {
              where: { node: { active: true } },
              include: { node: true },
              orderBy: { priority: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const activePack = packs.find(
      (pack) =>
        pack.status === TrafficPackStatus.ACTIVE &&
        pack.remainingBytes > BigInt(0) &&
        (!pack.expiresAt || pack.expiresAt > now) &&
        pack.accessProfile?.nodeBindings[0],
    );
    if (!subscription && !activePack) {
      throw new NotFoundException('No active access entitlement');
    }
    const node =
      subscription?.node ?? activePack!.accessProfile!.nodeBindings[0].node;
    const entitlementEndsAt =
      subscription?.endsAt ?? activePack!.expiresAt ?? now;
    const subscriptionView = subscription
      ? this.presentSubscription(subscription)
      : {
          id: activePack!.id,
          userId,
          userEmail: user.email,
          userDisplayName: user.displayName,
          planId: 'traffic_pack',
          planName: activePack!.label,
          nodeId: node.id,
          nodeLabel: node.label,
          status: 'active' as const,
          startsAt: activePack!.createdAt.toISOString(),
          endsAt: entitlementEndsAt.toISOString(),
          includedTrafficBytes: Number(activePack!.totalBytes),
          bonusTrafficBytes: 0,
          consumedTrafficBytes: Number(
            activePack!.totalBytes - activePack!.remainingBytes,
          ),
          speedUpMbpsSnapshot: activePack!.accessProfile!.speedUpMbps,
          speedDownMbpsSnapshot: activePack!.accessProfile!.speedDownMbps,
          deviceLimitSnapshot: activePack!.accessProfile!.deviceLimit,
          trafficRemainingBytes: usage.totalRemainingBytes,
          createdAt: activePack!.createdAt.toISOString(),
          updatedAt: activePack!.updatedAt.toISOString(),
        };
    const planView = subscription
      ? this.presentPlanShallow(subscription.plan)
      : {
          id: 'traffic_pack',
          slug: 'traffic-pack',
          name: activePack!.label,
          description: '独立流量权益',
          active: true,
          trafficBytes: Number(activePack!.totalBytes),
          durationDays: Math.max(
            1,
            Math.ceil(
              (entitlementEndsAt.getTime() - activePack!.createdAt.getTime()) /
                86_400_000,
            ),
          ),
          speedUpMbps: activePack!.accessProfile!.speedUpMbps,
          speedDownMbps: activePack!.accessProfile!.speedDownMbps,
          deviceLimit: activePack!.accessProfile!.deviceLimit,
          priceCents: 0,
          accent: 'teal',
          createdAt: activePack!.createdAt.toISOString(),
          updatedAt: activePack!.updatedAt.toISOString(),
        };

    return {
      user: this.presentUser({
        ...user,
        accessTokens: await this.prisma.accessToken.findMany({
          where: { userId, revokedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
      }),
      subscription: subscriptionView,
      plan: planView,
      nodeLabel: node.label,
      remainingBytes: usage.totalRemainingBytes,
      balanceCents: user.balanceCents,
      online,
      packs: packs.map((pack) => this.presentTrafficPack(pack)),
    };
  }

  async getAccessBundle(userId: string) {
    const user = await this.mustGetUserRecord(userId);
    const token = await this.mustGetAccessTokenByUser(userId);
    const now = new Date();
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
      },
      include: { plan: true, node: true, trafficPacks: true },
      orderBy: { endsAt: 'desc' },
    });
    const packs = await this.prisma.trafficPack.findMany({
      where: {
        userId,
        status: TrafficPackStatus.ACTIVE,
        remainingBytes: { gt: BigInt(0) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        accessProfile: {
          include: {
            nodeBindings: {
              where: { node: { active: true } },
              include: { node: true },
              orderBy: { priority: 'asc' },
            },
          },
        },
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });
    const nodes = new Map<string, Prisma.NodeGetPayload<object>>();
    if (subscription) {
      const bindings = subscription.plan.accessProfileId
        ? await this.prisma.accessProfileNode.findMany({
            where: {
              accessProfileId: subscription.plan.accessProfileId,
              node: { active: true },
            },
            include: { node: true },
            orderBy: { priority: 'asc' },
          })
        : await this.prisma.planBinding.findMany({
            where: { planId: subscription.planId, node: { active: true } },
            include: { node: true },
            orderBy: { priority: 'asc' },
          });
      for (const binding of bindings) nodes.set(binding.nodeId, binding.node);
    }
    for (const pack of packs) {
      for (const binding of pack.accessProfile?.nodeBindings ?? []) {
        nodes.set(binding.nodeId, binding.node);
      }
    }
    const nodeList = [...nodes.values()];
    if (nodeList.length === 0) {
      throw new NotFoundException('No active nodes are available');
    }
    const node = nodeList[0];
    const usage = await this.getUsageForUser(userId);
    const limits = [
      ...(subscription
        ? [
            {
              up: subscription.speedUpMbpsSnapshot,
              down: subscription.speedDownMbpsSnapshot,
              devices: subscription.deviceLimitSnapshot,
              endsAt: subscription.endsAt,
            },
          ]
        : []),
      ...packs.map((pack) => ({
        up: pack.accessProfile?.speedUpMbps ?? 0,
        down: pack.accessProfile?.speedDownMbps ?? 0,
        devices: pack.accessProfile?.deviceLimit ?? 1,
        endsAt: pack.expiresAt ?? new Date('9999-12-31T23:59:59.999Z'),
      })),
    ];
    const effectiveEndsAt = limits.reduce(
      (latest, item) => (item.endsAt > latest ? item.endsAt : latest),
      now,
    );
    const subscriptionView = subscription
      ? this.presentSubscription({ ...subscription, user, trafficPacks: [] })
      : {
          id: packs[0].id,
          userId,
          userEmail: user.email,
          userDisplayName: user.displayName,
          planId: 'traffic_pack',
          planName: packs[0].label,
          nodeId: node.id,
          nodeLabel: node.label,
          status: 'active' as const,
          startsAt: packs[0].createdAt.toISOString(),
          endsAt: effectiveEndsAt.toISOString(),
          includedTrafficBytes: usage.packRemainingBytes,
          bonusTrafficBytes: 0,
          consumedTrafficBytes: 0,
          speedUpMbpsSnapshot: Math.max(...limits.map((item) => item.up)),
          speedDownMbpsSnapshot: Math.max(...limits.map((item) => item.down)),
          deviceLimitSnapshot: Math.max(...limits.map((item) => item.devices)),
          trafficRemainingBytes: usage.totalRemainingBytes,
          createdAt: packs[0].createdAt.toISOString(),
          updatedAt: packs[0].updatedAt.toISOString(),
        };

    return {
      user: this.presentUser({ ...user, accessTokens: [token] }),
      subscription: subscriptionView,
      node,
      nodes: nodeList,
      token,
      trafficRemaining: usage.totalRemainingBytes,
    };
  }

  async getAccessBundleByToken(tokenValue: string) {
    const token = await this.prisma.accessToken.findFirst({
      where: { token: tokenValue, revokedAt: null },
    });
    if (!token) {
      throw new NotFoundException('Subscription not found');
    }

    const bundle = await this.getAccessBundle(token.userId);
    return { ...bundle, token };
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
      throw new BadRequestException(
        'Renewal order requires a plan or duration days',
      );
    }

    if (
      input.kind === 'traffic_pack' &&
      (input.trafficBytes === undefined || input.trafficBytes <= 0)
    ) {
      throw new BadRequestException(
        'Traffic pack order requires traffic bytes',
      );
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
            processedById:
              requestedStatus === 'applied' ? input.processedById : undefined,
            planId: input.planId,
            status:
              requestedStatus === 'applied'
                ? OrderStatus.APPLIED
                : OrderStatus.PENDING,
            kind: this.toDbOrderKind(input.kind),
            amountCents: input.amountCents,
            durationDays:
              input.durationDays ?? (plan ? plan.durationDays : undefined),
            trafficBytes:
              input.trafficBytes !== undefined
                ? BigInt(input.trafficBytes)
                : undefined,
            note: input.note,
            processedAt: requestedStatus === 'applied' ? timestamp : undefined,
          },
          include: {
            user: true,
            processedBy: true,
            plan: true,
            trafficPackProduct: true,
          },
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
      throw new ConflictException(
        'User already has a pending plan order awaiting processing',
      );
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
          note:
            input.note?.trim() ||
            `Plan request for ${plan.name} by ${user.email}`,
        },
        include: {
          user: true,
          processedBy: true,
          plan: true,
          trafficPackProduct: true,
        },
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
      include: {
        user: true,
        processedBy: true,
        plan: true,
        trafficPackProduct: true,
      },
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
            status:
              input.status === 'void' ? OrderStatus.VOID : OrderStatus.APPLIED,
            processedAt,
          },
          include: {
            user: true,
            processedBy: true,
            plan: true,
            trafficPackProduct: true,
          },
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

    const [token, node] = await Promise.all([
      this.prisma.accessToken.findFirst({
        where: { token: input.tokenValue, revokedAt: null },
      }),
      this.prisma.node.findUnique({ where: { id: input.nodeId } }),
    ]);
    if (!token) {
      return this.rejectAuth(
        'token_not_found',
        input,
        undefined,
        undefined,
        node?.id,
      );
    }

    const user = await this.mustGetUserRecord(token.userId);

    if (!node || !node.active || node.protocol !== NodeProtocol.HYSTERIA2) {
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

    // Check node is bound to this subscription's plan
    const bindingAllowed = await this.prisma.planBinding.findFirst({
      where: { planId: subscription.planId, nodeId: node.id },
    });
    if (!bindingAllowed) {
      return this.rejectAuth(
        'node_forbidden',
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

    const onlineCount = await this.presence.countForUser(user.id);
    const reconnecting = await this.isRecentReconnect(
      user.id,
      input.remoteAddr,
    );
    if (onlineCount >= subscription.deviceLimitSnapshot && !reconnecting) {
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

  async applyTrafficBatch(
    nodeId: string,
    batch: {
      id: string;
      claimedAt: string;
      traffic: Record<string, { tx: number; rx: number }>;
    },
  ) {
    if (!batch.id.trim()) throw new BadRequestException('Batch id is required');
    const claimedAt = new Date(batch.claimedAt);
    if (Number.isNaN(claimedAt.getTime())) {
      throw new BadRequestException('Invalid batch claimedAt');
    }
    for (const counters of Object.values(batch.traffic)) {
      if (
        !Number.isSafeInteger(counters.tx) ||
        !Number.isSafeInteger(counters.rx) ||
        counters.tx < 0 ||
        counters.rx < 0
      ) {
        throw new BadRequestException('Traffic counters must be safe integers');
      }
    }

    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.usageImportBatch.findUnique({
              where: {
                nodeId_externalId: { nodeId, externalId: batch.id },
              },
            });
            if (existing) {
              return {
                replayed: true,
                impactedUsers: Object.keys(batch.traffic),
              };
            }

            const values = Object.values(batch.traffic);
            const imported = await tx.usageImportBatch.create({
              data: {
                nodeId,
                externalId: batch.id,
                claimedAt,
                totalTxBytes: values.reduce(
                  (sum, item) => sum + BigInt(item.tx),
                  BigInt(0),
                ),
                totalRxBytes: values.reduce(
                  (sum, item) => sum + BigInt(item.rx),
                  BigInt(0),
                ),
                recordCount: values.length,
              },
            });

            const impactedUsers: string[] = [];
            for (const [userId, counters] of Object.entries(batch.traffic)) {
              const impacted = await this.applyUserTrafficInTransaction(
                tx,
                nodeId,
                userId,
                counters,
                imported.id,
                claimedAt,
              );
              if (impacted) impactedUsers.push(userId);
            }
            return { replayed: false, impactedUsers };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002') &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Traffic batch could not be applied');
  }

  async acknowledgeTrafficBatch(nodeId: string, externalId: string) {
    await this.prisma.usageImportBatch.update({
      where: { nodeId_externalId: { nodeId, externalId } },
      data: { status: 'ACKED', ackedAt: new Date() },
    });
  }

  private async applyUserTraffic(
    nodeId: string,
    userId: string,
    counters: { tx: number; rx: number },
  ): Promise<string | null> {
    return this.prisma.$transaction((tx) =>
      this.applyUserTrafficInTransaction(tx, nodeId, userId, counters),
    );
  }

  private async applyUserTrafficInTransaction(
    tx: Prisma.TransactionClient,
    nodeId: string,
    userId: string,
    counters: { tx: number; rx: number },
    importBatchId?: string,
    bucketStart = new Date(),
  ): Promise<string | null> {
    const subscription = await tx.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: new Date() },
      },
      orderBy: { endsAt: 'desc' },
    });

    if (!subscription) return null;

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
        if (remaining <= 0) break;

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
        bucketStart,
        txBytes: BigInt(counters.tx),
        rxBytes: BigInt(counters.rx),
        source: 'sync',
        importBatchId,
      },
    });
    return userId;
  }

  async isRecentReconnect(userId: string, remoteAddr?: string) {
    const host = remoteHost(remoteAddr);
    if (!host) return false;

    const recentGrants = await this.prisma.authEvent.findMany({
      where: {
        userId,
        granted: true,
        createdAt: {
          gte: new Date(Date.now() - reconnectGraceMs),
        },
      },
      select: { remoteAddr: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return recentGrants.some(
      (event) => remoteHost(event.remoteAddr ?? undefined) === host,
    );
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

    return bindings.filter((b) => b.node.active).map((b) => b.node.id);
  }

  async getManualOrders(query: ManualOrderQuery = {}) {
    const { page, pageSize, skip } = parsePage(query);
    const q = query.q?.trim();
    const where: Prisma.ManualOrderWhereInput = {
      status: query.status ? (query.status.toUpperCase() as never) : undefined,
      source: query.source ? (query.source.toUpperCase() as never) : undefined,
      OR: q
        ? [
            { id: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { displayName: { contains: q, mode: 'insensitive' } } },
            {
              productNameSnapshot: {
                contains: q,
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    };
    const [orders, total] = await Promise.all([
      this.prisma.manualOrder.findMany({
        where,
        include: {
          user: true,
          processedBy: true,
          plan: true,
          trafficPackProduct: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.manualOrder.count({ where }),
    ]);

    return pageResponse(
      orders.map((order) => this.presentManualOrder(order)),
      total,
      page,
      pageSize,
    );
  }

  async getManualOrdersForUser(userId: string) {
    const orders = await this.prisma.manualOrder.findMany({
      where: { userId },
      include: {
        user: true,
        processedBy: true,
        plan: true,
        trafficPackProduct: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => this.presentManualOrder(order));
  }

  async getRedemptionCodes(query: RedemptionCodeQuery = {}) {
    await this.expireRedemptionCodes();
    const { page, pageSize, skip } = parsePage(query);
    const q = query.q?.trim();
    const where: Prisma.RedemptionCodeWhereInput = {
      status: query.status ? (query.status.toUpperCase() as never) : undefined,
      kind: query.kind
        ? this.toDbRedemptionCodeKind(query.kind as CdkKind)
        : undefined,
      OR: q
        ? [
            { code: { contains: q, mode: 'insensitive' } },
            { label: { contains: q, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [codes, total] = await Promise.all([
      this.prisma.redemptionCode.findMany({
        where,
        include: {
          plan: true,
          catalogOffer: {
            include: { product: { include: { legacyPlan: true } } },
          },
          createdBy: true,
          redeemedBy: true,
          trafficPackProduct: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.redemptionCode.count({ where }),
    ]);

    return pageResponse(
      codes.map((code) => this.presentRedemptionCode(code)),
      total,
      page,
      pageSize,
    );
  }

  async createRedemptionCode(input: {
    label: string;
    code?: string;
    kind: CdkKind;
    planId?: string;
    catalogOfferId?: string;
    planMode?: 'renew' | 'replace';
    trafficPackProductId?: string;
    trafficBytes?: number;
    amountCents?: number;
    discountPercent?: number;
    discountCents?: number;
    maxUses?: number;
    count?: number;
    note?: string;
    expiresAt?: string;
    createdById?: string;
  }) {
    if (input.kind === 'plan' && !input.catalogOfferId && !input.planId) {
      throw new BadRequestException('套餐兑换码需要选择套餐周期');
    }

    if (input.kind === 'traffic_pack' && !input.trafficPackProductId) {
      throw new BadRequestException('流量包兑换码必须绑定流量包商品');
    }

    if (
      input.kind === 'balance' &&
      (!input.amountCents || input.amountCents <= 0)
    ) {
      throw new BadRequestException('余额兑换码需要填写充值金额');
    }

    if (input.kind === 'discount') {
      const hasPercent =
        input.discountPercent !== undefined && input.discountPercent > 0;
      const hasFixed =
        input.discountCents !== undefined && input.discountCents > 0;
      if (!hasPercent && !hasFixed) {
        throw new BadRequestException('折扣兑换码需要填写折扣百分比或定额减免');
      }
      if (hasPercent && input.discountPercent! > 100) {
        throw new BadRequestException('折扣百分比不能超过 100');
      }
    }

    const maxUses = input.maxUses ?? 1;
    if (maxUses < 1) {
      throw new BadRequestException('使用次数至少为 1');
    }

    const count = input.count ?? 1;
    if (count < 1 || count > 500) {
      throw new BadRequestException('生成数量需在 1-500 之间');
    }
    if (count > 1 && input.code) {
      throw new BadRequestException('批量生成不支持自定义兑换码');
    }

    let catalogOffer = input.catalogOfferId
      ? await this.prisma.catalogOffer.findUnique({
          where: { id: input.catalogOfferId },
          include: { product: true },
        })
      : null;
    if (!catalogOffer && input.kind === 'plan' && input.planId) {
      catalogOffer = await this.prisma.catalogOffer.findFirst({
        where: {
          product: { legacyPlanId: input.planId },
          active: true,
          archivedAt: null,
        },
        include: { product: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
    }
    if (
      input.kind === 'plan' &&
      (!catalogOffer || catalogOffer.product.kind !== 'PLAN')
    ) {
      throw new BadRequestException('套餐兑换码需要有效的套餐周期');
    }
    if (input.planId && !catalogOffer) {
      await this.mustGetPlanRecord(input.planId);
    }

    const trafficPackProduct = input.trafficPackProductId
      ? await this.mustGetTrafficPackProductRecord(input.trafficPackProductId)
      : null;

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
      if (exists) throw new ConflictException(`兑换码 "${input.code}" 已存在`);
    }

    // Build the set of unique codes to create (custom code only for count === 1).
    const codeValues: string[] = [];
    if (count === 1 && input.code) {
      codeValues.push(input.code);
    } else {
      const seen = new Set<string>();
      while (seen.size < count) {
        seen.add(await this.generateUniqueRedemptionCode());
      }
      codeValues.push(...seen);
    }

    const sharedData = {
      label: input.label,
      kind: this.toDbRedemptionCodeKind(input.kind),
      planId:
        input.kind === 'plan'
          ? (catalogOffer?.product.legacyPlanId ?? input.planId)
          : undefined,
      catalogOfferId: input.kind === 'plan' ? catalogOffer?.id : undefined,
      planMode:
        input.kind === 'plan' && input.planMode === 'replace'
          ? RedemptionPlanMode.REPLACE
          : RedemptionPlanMode.RENEW,
      trafficPackProductId:
        input.kind === 'traffic_pack' ? input.trafficPackProductId : undefined,
      trafficBytes:
        input.kind === 'traffic_pack' && trafficPackProduct
          ? trafficPackProduct.trafficBytes
          : undefined,
      amountCents:
        input.kind === 'plan' && catalogOffer
          ? catalogOffer.priceCents
          : input.kind === 'traffic_pack' && trafficPackProduct
            ? trafficPackProduct.priceCents
            : (input.amountCents ?? 0),
      discountPercent:
        input.kind === 'discount' ? (input.discountPercent ?? null) : null,
      discountCents:
        input.kind === 'discount' ? (input.discountCents ?? null) : null,
      maxUses,
      note: input.note,
      expiresAt,
      createdById: input.createdById,
    };

    try {
      await this.prisma.redemptionCode.createMany({
        data: codeValues.map((code) => ({ code, ...sharedData })),
      });
      const created = await this.prisma.redemptionCode.findMany({
        where: { code: { in: codeValues } },
        include: {
          plan: true,
          catalogOffer: {
            include: { product: { include: { legacyPlan: true } } },
          },
          createdBy: true,
          redeemedBy: true,
          trafficPackProduct: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return created.map((code) => this.presentRedemptionCode(code));
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getRedemptionCodeUses(codeId: string, query: PageQuery = {}) {
    const { page, pageSize, skip } = parsePage(query);
    const where = { codeId };
    const [uses, total] = await Promise.all([
      this.prisma.redemptionUse.findMany({
        where,
        include: { user: true },
        orderBy: [{ redeemedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.redemptionUse.count({ where }),
    ]);
    return pageResponse(
      uses.map((use) => ({
        id: use.id,
        userId: use.userId,
        userEmail: use.user?.email ?? null,
        userDisplayName: use.user?.displayName ?? null,
        orderId: use.orderId,
        redeemedAt: use.redeemedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  async patchRedemptionCode(
    codeId: string,
    input: { status?: 'active' | 'void' },
  ) {
    const current = await this.prisma.redemptionCode.findUnique({
      where: { id: codeId },
      include: {
        plan: true,
        catalogOffer: {
          include: { product: { include: { legacyPlan: true } } },
        },
        createdBy: true,
        redeemedBy: true,
        trafficPackProduct: true,
      },
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
          status: input.status
            ? this.toDbRedemptionCodeStatus(input.status)
            : undefined,
        }),
        include: {
          plan: true,
          catalogOffer: {
            include: { product: { include: { legacyPlan: true } } },
          },
          createdBy: true,
          redeemedBy: true,
          trafficPackProduct: true,
        },
      });

      return this.presentRedemptionCode(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async redeemRedemptionCode(
    userId: string,
    rawCode: string,
    expectedTrafficPackProductId?: string,
  ) {
    await this.mustGetUserRecord(userId);
    await this.expireOverdueSubscriptions();
    await this.expireTrafficPacks();
    await this.expireRedemptionCodes();

    const codeValue = this.normalizeRedemptionCode(rawCode);
    const existing = await this.prisma.redemptionCode.findUnique({
      where: { code: codeValue },
      include: {
        plan: true,
        catalogOffer: {
          include: { product: { include: { legacyPlan: true } } },
        },
        createdBy: true,
        redeemedBy: true,
        trafficPackProduct: true,
      },
    });

    if (!existing) throw new NotFoundException('兑换码不存在');
    if (existing.status === RedemptionCodeStatus.REDEEMED)
      throw new BadRequestException('兑换码已用完');
    if (existing.status === RedemptionCodeStatus.VOID)
      throw new BadRequestException('兑换码已作废');
    if (existing.status === RedemptionCodeStatus.EXPIRED)
      throw new BadRequestException('兑换码已过期');

    if (this.fromDbRedemptionCodeKind(existing.kind) === 'discount') {
      throw new BadRequestException('折扣码请在购买套餐结算时使用');
    }

    if (
      expectedTrafficPackProductId &&
      (existing.kind !== RedemptionCodeKind.TRAFFIC_PACK ||
        existing.trafficPackProductId !== expectedTrafficPackProductId)
    ) {
      throw new BadRequestException('兑换码与所选流量包商品不匹配');
    }

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
          include: {
            plan: true,
            catalogOffer: {
              include: { product: { include: { legacyPlan: true } } },
            },
            createdBy: true,
            redeemedBy: true,
            trafficPackProduct: true,
          },
        });

        if (!code) throw new NotFoundException('兑换码不存在');
        if (code.status !== RedemptionCodeStatus.ACTIVE)
          throw new BadRequestException('兑换码当前不可使用');
        if (code.usedCount >= code.maxUses)
          throw new BadRequestException('兑换码已用完');

        // One use per user per code.
        const priorUse = await tx.redemptionUse.findUnique({
          where: { codeId_userId: { codeId: code.id, userId } },
        });
        if (priorUse) throw new BadRequestException('你已经使用过这张兑换码');

        const reserved = await tx.redemptionCode.updateMany({
          where: {
            id: code.id,
            status: RedemptionCodeStatus.ACTIVE,
            usedCount: { lt: code.maxUses },
          },
          data: { usedCount: { increment: 1 } },
        });
        if (reserved.count !== 1) {
          throw new BadRequestException('兑换码已用完');
        }

        const openSubscription = await this.findOpenSubscriptionForUser(
          tx,
          userId,
        );

        let order: Awaited<
          ReturnType<typeof this.applyPlanRedemptionCode>
        > | null = null;
        if (code.kind === RedemptionCodeKind.PLAN) {
          order = await this.applyPlanRedemptionCode(tx, {
            userId,
            code,
            openSubscription,
            redeemedAt: timestamp,
          });
        } else if (code.kind === RedemptionCodeKind.TRAFFIC_PACK) {
          order = await this.applyTrafficPackRedemptionCode(tx, {
            userId,
            code,
            openSubscription,
            redeemedAt: timestamp,
          });
        } else if (code.kind === RedemptionCodeKind.BALANCE) {
          await tx.user.update({
            where: { id: userId },
            data: { balanceCents: { increment: code.amountCents } },
          });
          await tx.walletTransaction.create({
            data: {
              userId,
              amountCents: code.amountCents,
              kind: 'TOPUP',
              note: `兑换码充值 ${code.code}`,
            },
          });
        }

        await tx.redemptionUse.create({
          data: { codeId: code.id, userId, orderId: order?.id ?? null },
        });

        const nextUsedCount = code.usedCount + 1;
        const exhausted = nextUsedCount >= code.maxUses;
        const redeemedCode = await tx.redemptionCode.update({
          where: { id: code.id },
          data: {
            status: exhausted
              ? RedemptionCodeStatus.REDEEMED
              : RedemptionCodeStatus.ACTIVE,
            redeemedById: userId,
            redeemedAt: timestamp,
          },
          include: {
            plan: true,
            catalogOffer: {
              include: { product: { include: { legacyPlan: true } } },
            },
            createdBy: true,
            redeemedBy: true,
            trafficPackProduct: true,
          },
        });

        const user = await tx.user.findUnique({ where: { id: userId } });

        return {
          code: redeemedCode,
          order,
          balanceCents: user?.balanceCents ?? 0,
        };
      });

      return {
        code: this.presentRedemptionCode(result.code),
        order: result.order ? this.presentManualOrder(result.order) : null,
        balanceCents: result.balanceCents,
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async getWallet(userId: string) {
    const user = await this.mustGetUserRecord(userId);
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      balanceCents: user.balanceCents,
      transactions: transactions.map((txn) => ({
        id: txn.id,
        amountCents: txn.amountCents,
        kind: txn.kind.toLowerCase(),
        note: txn.note,
        createdAt: txn.createdAt.toISOString(),
      })),
    };
  }

  /** Admin sets a user's balance to an absolute value, logging the delta. */
  async adjustUserBalance(
    userId: string,
    newBalanceCents: number,
    note?: string,
  ) {
    const user = await this.mustGetUserRecord(userId);
    if (newBalanceCents < 0) {
      throw new BadRequestException('余额不能为负');
    }
    const delta = newBalanceCents - user.balanceCents;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { balanceCents: newBalanceCents },
      });
      if (delta !== 0) {
        await tx.walletTransaction.create({
          data: {
            userId,
            amountCents: delta,
            kind: 'ADJUST',
            note: note?.trim() || '管理员调整余额',
          },
        });
      }
    });
    return this.getWallet(userId);
  }

  /**
   * Validate a discount code for a checkout and compute the discount in cents
   * (capped at the base price). Does NOT mutate anything.
   */
  private async resolveDiscount(
    tx: Prisma.TransactionClient,
    rawCode: string,
    userId: string,
    basePriceCents: number,
  ) {
    const codeValue = this.normalizeRedemptionCode(rawCode);
    const code = await tx.redemptionCode.findUnique({
      where: { code: codeValue },
    });
    if (!code || code.kind !== RedemptionCodeKind.DISCOUNT) {
      throw new BadRequestException('折扣码无效');
    }
    if (code.status === RedemptionCodeStatus.VOID) {
      throw new BadRequestException('折扣码已作废');
    }
    if (
      code.status !== RedemptionCodeStatus.ACTIVE ||
      code.usedCount >= code.maxUses
    ) {
      throw new BadRequestException('折扣码已用完');
    }
    if (code.expiresAt && code.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('折扣码已过期');
    }
    const priorUse = await tx.redemptionUse.findUnique({
      where: { codeId_userId: { codeId: code.id, userId } },
    });
    if (priorUse) {
      throw new BadRequestException('你已经使用过这张折扣码');
    }

    let discount = 0;
    if (code.discountPercent && code.discountPercent > 0) {
      discount = Math.floor((basePriceCents * code.discountPercent) / 100);
    } else if (code.discountCents && code.discountCents > 0) {
      discount = code.discountCents;
    }
    discount = Math.min(discount, basePriceCents);
    return { code, discountCents: discount };
  }

  async quotePurchase(userId: string, planId: string, discountCode?: string) {
    const user = await this.mustGetUserRecord(userId);
    const plan = await this.mustGetPlanRecord(planId);
    if (!plan.active) {
      throw new BadRequestException('套餐已下架');
    }

    const basePriceCents = plan.priceCents;
    let discountCents = 0;
    let discountLabel: string | null = null;
    if (discountCode?.trim()) {
      const resolved = await this.resolveDiscount(
        this.prisma,
        discountCode,
        userId,
        basePriceCents,
      );
      discountCents = resolved.discountCents;
      discountLabel = resolved.code.label;
    }

    const finalPriceCents = Math.max(basePriceCents - discountCents, 0);
    return {
      planId: plan.id,
      planName: plan.name,
      basePriceCents,
      discountCents,
      discountLabel,
      finalPriceCents,
      balanceCents: user.balanceCents,
      sufficient: user.balanceCents >= finalPriceCents,
    };
  }

  async purchaseWithBalance(
    userId: string,
    planId: string,
    discountCode?: string,
  ) {
    await this.mustGetUserRecord(userId);
    const plan = await this.mustGetPlanRecord(planId);
    if (!plan.active) {
      throw new BadRequestException('套餐已下架');
    }
    await this.resolvePlanNode(this.prisma, { planId });

    const timestamp = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('用户不存在');

        const basePriceCents = plan.priceCents;
        let discountCents = 0;
        let discountCodeId: string | null = null;
        if (discountCode?.trim()) {
          const resolved = await this.resolveDiscount(
            tx,
            discountCode,
            userId,
            basePriceCents,
          );
          discountCents = resolved.discountCents;
          discountCodeId = resolved.code.id;
        }

        const finalPriceCents = Math.max(basePriceCents - discountCents, 0);
        if (user.balanceCents < finalPriceCents) {
          throw new BadRequestException('余额不足，请先充值');
        }

        await tx.user.update({
          where: { id: userId },
          data: { balanceCents: { decrement: finalPriceCents } },
        });
        await tx.walletTransaction.create({
          data: {
            userId,
            amountCents: -finalPriceCents,
            kind: 'PURCHASE',
            note: `购买套餐 ${plan.name}`,
          },
        });

        const order = await tx.manualOrder.create({
          data: {
            userId,
            planId: plan.id,
            status: OrderStatus.APPLIED,
            kind: OrderKind.RENEWAL,
            amountCents: finalPriceCents,
            durationDays: plan.durationDays,
            note:
              discountCents > 0
                ? `余额购买（折扣 ${this.formatCents(discountCents)}）`
                : '余额购买',
            processedAt: timestamp,
          },
        });

        await this.grantPlanEntitlement(tx, {
          userId,
          planId: plan.id,
          grantedAt: timestamp,
        });

        if (discountCodeId) {
          const discountRecord = await tx.redemptionCode.findUnique({
            where: { id: discountCodeId },
          });
          if (discountRecord) {
            await tx.redemptionUse.create({
              data: {
                codeId: discountRecord.id,
                userId,
                orderId: order.id,
              },
            });
            const nextUsed = discountRecord.usedCount + 1;
            await tx.redemptionCode.update({
              where: { id: discountRecord.id },
              data: {
                usedCount: nextUsed,
                status:
                  nextUsed >= discountRecord.maxUses
                    ? RedemptionCodeStatus.REDEEMED
                    : RedemptionCodeStatus.ACTIVE,
                redeemedById: userId,
                redeemedAt: timestamp,
              },
            });
          }
        }
      });
    } catch (error) {
      this.handlePrismaError(error);
    }

    return this.getPortalOverview(userId);
  }

  async quoteTrafficPackPurchase(
    userId: string,
    productId: string,
    discountCode?: string,
  ) {
    const user = await this.mustGetUserRecord(userId);
    const product = await this.mustGetTrafficPackProductRecord(productId);
    if (!product.active || !product.accessProfileId || !product.validityDays) {
      throw new BadRequestException('流量包已下架');
    }

    const basePriceCents = product.priceCents;
    let discountCents = 0;
    let discountLabel: string | null = null;
    if (discountCode?.trim()) {
      const resolved = await this.resolveDiscount(
        this.prisma,
        discountCode,
        userId,
        basePriceCents,
      );
      discountCents = resolved.discountCents;
      discountLabel = resolved.code.label;
    }

    const finalPriceCents = Math.max(basePriceCents - discountCents, 0);
    return {
      productId: product.id,
      productName: product.name,
      basePriceCents,
      discountCents,
      discountLabel,
      finalPriceCents,
      balanceCents: user.balanceCents,
      sufficient: user.balanceCents >= finalPriceCents,
    };
  }

  async purchaseTrafficPackWithBalance(
    userId: string,
    productId: string,
    discountCode?: string,
  ) {
    await this.expireOverdueSubscriptions();
    const timestamp = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('用户不存在');

        const product = await tx.trafficPackProduct.findUnique({
          where: { id: productId },
          include: {
            accessProfile: {
              include: {
                nodeBindings: { where: { node: { active: true } }, take: 1 },
              },
            },
          },
        });
        if (!product)
          throw new NotFoundException(
            `Unknown traffic pack product: ${productId}`,
          );
        if (
          !product.active ||
          !product.validityDays ||
          !product.accessProfile?.active ||
          product.accessProfile.nodeBindings.length === 0
        ) {
          throw new BadRequestException('流量包未配置可用访问节点');
        }

        const subscription = await tx.subscription.findFirst({
          where: {
            userId,
            status: SubscriptionStatus.ACTIVE,
            endsAt: { gt: timestamp },
          },
          orderBy: { endsAt: 'desc' },
        });
        if (!subscription) {
          throw new BadRequestException('请先开通有效套餐');
        }
        const productExpiresAt = this.buildSubscriptionEndDate(
          timestamp,
          product.validityDays,
        );
        const expiresAt =
          productExpiresAt < subscription.endsAt
            ? productExpiresAt
            : subscription.endsAt;

        let discountCents = 0;
        let discountCodeId: string | null = null;
        if (discountCode?.trim()) {
          const resolved = await this.resolveDiscount(
            tx,
            discountCode,
            userId,
            product.priceCents,
          );
          discountCents = resolved.discountCents;
          discountCodeId = resolved.code.id;
        }

        const finalPriceCents = Math.max(product.priceCents - discountCents, 0);
        const debit = await tx.user.updateMany({
          where: { id: userId, balanceCents: { gte: finalPriceCents } },
          data: { balanceCents: { decrement: finalPriceCents } },
        });
        if (debit.count !== 1) {
          throw new BadRequestException('余额不足，请先充值');
        }

        await tx.walletTransaction.create({
          data: {
            userId,
            amountCents: -finalPriceCents,
            kind: 'PURCHASE',
            note: `购买流量包 ${product.name}`,
          },
        });

        const order = await tx.manualOrder.create({
          data: {
            userId,
            trafficPackProductId: product.id,
            status: OrderStatus.APPLIED,
            kind: OrderKind.TRAFFIC_PACK,
            amountCents: finalPriceCents,
            trafficBytes: product.trafficBytes,
            validityDays: product.validityDays,
            entitlementExpiresAt: expiresAt,
            accessProfileIdSnapshot: product.accessProfileId,
            note:
              discountCents > 0
                ? `${product.name}（折扣 ${this.formatCents(discountCents)}）`
                : product.name,
            processedAt: timestamp,
          },
        });

        const account = await tx.accessAccount.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        await tx.trafficPack.create({
          data: {
            userId,
            subscriptionId: subscription.id,
            accessAccountId: account.id,
            trafficPackProductId: product.id,
            accessProfileId: product.accessProfileId,
            label: product.name,
            totalBytes: product.trafficBytes,
            remainingBytes: product.trafficBytes,
            status: TrafficPackStatus.ACTIVE,
            expiresAt,
          },
        });

        if (discountCodeId) {
          const discountRecord = await tx.redemptionCode.findUnique({
            where: { id: discountCodeId },
          });
          if (discountRecord) {
            await tx.redemptionUse.create({
              data: { codeId: discountRecord.id, userId, orderId: order.id },
            });
            const nextUsed = discountRecord.usedCount + 1;
            await tx.redemptionCode.update({
              where: { id: discountRecord.id },
              data: {
                usedCount: nextUsed,
                status:
                  nextUsed >= discountRecord.maxUses
                    ? RedemptionCodeStatus.REDEEMED
                    : RedemptionCodeStatus.ACTIVE,
                redeemedById: userId,
                redeemedAt: timestamp,
              },
            });
          }
        }
      });
    } catch (error) {
      this.handlePrismaError(error);
    }

    return this.getPortalOverview(userId);
  }

  private formatCents(cents: number) {
    return `¥${(cents / 100).toFixed(2)}`;
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

  async getUsageRollups(limit = 200) {
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

  async getUsageSummary() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
    fourteenDaysAgo.setUTCHours(0, 0, 0, 0);

    const [totals, last24Hours, last7Days, nodeGroups, userGroups, dailyRows] =
      await Promise.all([
        this.prisma.usageRollup.aggregate({
          _sum: { txBytes: true, rxBytes: true },
          _count: { _all: true },
        }),
        this.prisma.usageRollup.aggregate({
          where: { bucketStart: { gte: dayAgo } },
          _sum: { txBytes: true, rxBytes: true },
        }),
        this.prisma.usageRollup.aggregate({
          where: { bucketStart: { gte: sevenDaysAgo } },
          _sum: { txBytes: true, rxBytes: true },
        }),
        this.prisma.usageRollup.groupBy({
          by: ['nodeId'],
          _sum: { txBytes: true, rxBytes: true },
          _count: { _all: true },
          _max: { bucketStart: true },
        }),
        this.prisma.usageRollup.groupBy({
          by: ['userId'],
          _sum: { txBytes: true, rxBytes: true },
          _count: { _all: true },
          _max: { bucketStart: true },
        }),
        this.prisma.$queryRaw<
          Array<{ date: string; txBytes: bigint; rxBytes: bigint }>
        >(Prisma.sql`
          SELECT
            to_char(date_trunc('day', "bucketStart"), 'YYYY-MM-DD') AS "date",
            COALESCE(SUM("txBytes"), 0)::bigint AS "txBytes",
            COALESCE(SUM("rxBytes"), 0)::bigint AS "rxBytes"
          FROM "UsageRollup"
          WHERE "bucketStart" >= ${fourteenDaysAgo}
          GROUP BY date_trunc('day', "bucketStart")
          ORDER BY date_trunc('day', "bucketStart") ASC
        `),
      ]);

    const [nodes, users] = await Promise.all([
      this.prisma.node.findMany({
        select: { id: true, label: true, active: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: userGroups.map((group) => group.userId) } },
        select: { id: true, email: true, displayName: true },
      }),
    ]);

    const nodeGroupMap = new Map(
      nodeGroups.map((group) => [group.nodeId, group]),
    );
    const userMap = new Map(users.map((user) => [user.id, user]));
    const numberValue = (value: bigint | null | undefined) =>
      Number(value ?? 0n);
    const totalValue = (
      tx: bigint | null | undefined,
      rx: bigint | null | undefined,
    ) => numberValue(tx) + numberValue(rx);

    const dailyMap = new Map<string, { txBytes: number; rxBytes: number }>();
    for (let index = 0; index < 14; index += 1) {
      const date = new Date(fourteenDaysAgo);
      date.setUTCDate(date.getUTCDate() + index);
      dailyMap.set(date.toISOString().slice(0, 10), { txBytes: 0, rxBytes: 0 });
    }
    for (const item of dailyRows) {
      const key = item.date;
      const current = dailyMap.get(key) ?? { txBytes: 0, rxBytes: 0 };
      current.txBytes += Number(item.txBytes);
      current.rxBytes += Number(item.rxBytes);
      dailyMap.set(key, current);
    }

    return {
      totals: {
        txBytes: numberValue(totals._sum.txBytes),
        rxBytes: numberValue(totals._sum.rxBytes),
        totalBytes: totalValue(totals._sum.txBytes, totals._sum.rxBytes),
        recordCount: totals._count._all,
        last24HoursBytes: totalValue(
          last24Hours._sum.txBytes,
          last24Hours._sum.rxBytes,
        ),
        last7DaysBytes: totalValue(
          last7Days._sum.txBytes,
          last7Days._sum.rxBytes,
        ),
      },
      daily: [...dailyMap.entries()].map(([date, value]) => ({
        date,
        ...value,
        totalBytes: value.txBytes + value.rxBytes,
      })),
      nodes: nodes
        .map((node) => {
          const group = nodeGroupMap.get(node.id);
          const txBytes = numberValue(group?._sum.txBytes);
          const rxBytes = numberValue(group?._sum.rxBytes);
          return {
            nodeId: node.id,
            nodeLabel: node.label,
            active: node.active,
            txBytes,
            rxBytes,
            totalBytes: txBytes + rxBytes,
            recordCount: group?._count._all ?? 0,
            lastSeenAt: group?._max.bucketStart?.toISOString() ?? null,
          };
        })
        .sort((a, b) => b.totalBytes - a.totalBytes),
      users: userGroups
        .map((group) => {
          const user = userMap.get(group.userId);
          const txBytes = numberValue(group._sum.txBytes);
          const rxBytes = numberValue(group._sum.rxBytes);
          return {
            userId: group.userId,
            userEmail: user?.email ?? '未知用户',
            userDisplayName: user?.displayName ?? '未知用户',
            txBytes,
            rxBytes,
            totalBytes: txBytes + rxBytes,
            recordCount: group._count._all,
            lastSeenAt: group._max.bucketStart?.toISOString() ?? null,
          };
        })
        .sort((a, b) => b.totalBytes - a.totalBytes)
        .slice(0, 10),
    };
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
    const offer =
      input.code.catalogOffer ??
      (input.code.planId
        ? await tx.catalogOffer.findFirst({
            where: {
              product: { legacyPlanId: input.code.planId },
              active: true,
              archivedAt: null,
            },
            include: { product: { include: { legacyPlan: true } } },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          })
        : null);
    const plan = offer?.product.legacyPlan ?? input.code.plan;
    if (!offer || !plan) {
      throw new BadRequestException(
        'Plan redemption code is missing a valid offer',
      );
    }
    const redemptionWindow = resolvePlanRedemptionWindow({
      mode: input.code.planMode,
      currentPlanId: input.openSubscription?.planId,
      targetPlanId: plan.id,
      currentEndsAt: input.openSubscription?.endsAt,
      redeemedAt: input.redeemedAt,
      intervalMonths: offer.intervalMonths,
      durationDays: plan.durationDays,
    });
    const entitlementExpiresAt = redemptionWindow.endsAt;

    const order = await tx.manualOrder.create({
      data: {
        userId: input.userId,
        planId: plan.id,
        planOfferId: offer.legacyPlanOfferId,
        catalogOfferId: offer.id,
        status: OrderStatus.APPLIED,
        kind: OrderKind.RENEWAL,
        source: OrderSource.CDK,
        amountCents: offer.priceCents,
        basePriceCents: offer.priceCents,
        discountCents: 0,
        currency: offer.currency,
        productSlugSnapshot: offer.slug,
        productNameSnapshot: `${offer.product.name} · ${offer.name}`,
        durationDays: plan.durationDays,
        trafficBytes: offer.trafficBytes,
        entitlementExpiresAt,
        billingPeriodSnapshot: offer.billingPeriod,
        intervalMonthsSnapshot: offer.intervalMonths,
        accessProfileIdSnapshot: offer.product.accessProfileId,
        note: input.code.note || `Redeemed ${input.code.code}`,
        processedAt: input.redeemedAt,
      },
      include: {
        user: true,
        processedBy: true,
        plan: true,
        trafficPackProduct: true,
      },
    });

    await this.grantPlanEntitlement(tx, {
      userId: input.userId,
      planId: plan.id,
      grantedAt: input.redeemedAt,
      openSubscription: input.openSubscription,
      durationMonths: offer.intervalMonths ?? undefined,
      planOfferId: offer.legacyPlanOfferId ?? undefined,
      trafficBytes: offer.trafficBytes,
      forceReplace: redemptionWindow.forceReplace,
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
        throw new BadRequestException(
          'Renewal order is missing duration or plan information',
        );
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
        throw new BadRequestException(
          'Traffic pack order is missing traffic bytes',
        );
      }
    }

    if (
      order.kind === OrderKind.MANUAL_CREDIT &&
      (!order.durationDays || order.durationDays <= 0) &&
      (!order.trafficBytes || order.trafficBytes <= BigInt(0))
    ) {
      throw new BadRequestException(
        'Manual credit order must grant duration days or traffic bytes',
      );
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
            (order.kind === OrderKind.TRAFFIC_PACK
              ? 'Manual traffic pack'
              : 'Manual top-up'),
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
      durationMonths?: number;
      planOfferId?: string;
      trafficBytes?: bigint;
      forceReplace?: boolean;
    },
  ) {
    const existingSubscription =
      input.openSubscription !== undefined
        ? input.openSubscription
        : await tx.subscription.findFirst({
            where: {
              userId: input.userId,
              status: {
                in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
              },
            },
            orderBy: { endsAt: 'desc' },
          });

    const { plan, nodeId } = await this.resolvePlanNode(tx, {
      planId: input.planId,
    });

    if (existingSubscription) {
      const isSamePlan = existingSubscription.planId === plan.id;

      if (isSamePlan && !input.forceReplace) {
        // Renewal of the current plan: extend the cycle and stack the plan's
        // traffic allotment onto the remaining balance.
        const extensionBase =
          existingSubscription.endsAt.getTime() > input.grantedAt.getTime()
            ? new Date(existingSubscription.endsAt)
            : new Date(input.grantedAt);
        const extendedEndsAt = input.durationMonths
          ? this.addUtcMonthsClamped(extensionBase, input.durationMonths)
          : this.buildSubscriptionEndDate(extensionBase, plan.durationDays);

        await tx.subscription.update({
          where: { id: existingSubscription.id },
          data: {
            nodeId,
            planOfferId: input.planOfferId,
            status: SubscriptionStatus.ACTIVE,
            endsAt: extendedEndsAt,
            includedTrafficBytes:
              input.trafficBytes ??
              existingSubscription.includedTrafficBytes + plan.trafficBytes,
            speedUpMbpsSnapshot: plan.speedUpMbps,
            speedDownMbpsSnapshot: plan.speedDownMbps,
            deviceLimitSnapshot: plan.deviceLimit,
          },
        });
        return;
      }

      // Switching to a different plan = immediate upgrade/downgrade, no
      // proration: the new plan's speed/device/traffic take effect now, the
      // billing cycle restarts from today, and the previous plan's remaining
      // base traffic and duration are discarded. Paid traffic packs are
      // independent add-ons and are intentionally left untouched.
      await tx.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          planId: plan.id,
          nodeId,
          planOfferId: input.planOfferId,
          status: SubscriptionStatus.ACTIVE,
          startsAt: input.grantedAt,
          endsAt: input.durationMonths
            ? this.addUtcMonthsClamped(input.grantedAt, input.durationMonths)
            : this.buildSubscriptionEndDate(input.grantedAt, plan.durationDays),
          includedTrafficBytes: input.trafficBytes ?? plan.trafficBytes,
          bonusTrafficBytes: BigInt(0),
          consumedTrafficBytes: BigInt(0),
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
        planOfferId: input.planOfferId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: input.grantedAt,
        endsAt: input.durationMonths
          ? this.addUtcMonthsClamped(input.grantedAt, input.durationMonths)
          : this.buildSubscriptionEndDate(input.grantedAt, plan.durationDays),
        includedTrafficBytes: input.trafficBytes ?? plan.trafficBytes,
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
    if (!input.code.trafficBytes || input.code.trafficBytes <= BigInt(0)) {
      throw new BadRequestException(
        'Traffic pack redemption code is missing traffic bytes',
      );
    }
    const product = input.code.trafficPackProduct;
    if (!product?.accessProfileId || !product.validityDays) {
      throw new BadRequestException('流量包兑换码未绑定有效商品配置');
    }
    const expiresAt = this.buildSubscriptionEndDate(
      input.redeemedAt,
      product.validityDays,
    );
    const account = await tx.accessAccount.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId },
      update: {},
    });

    const order = await tx.manualOrder.create({
      data: {
        userId: input.userId,
        trafficPackProductId: input.code.trafficPackProductId,
        status: OrderStatus.APPLIED,
        kind: OrderKind.TRAFFIC_PACK,
        source: OrderSource.CDK,
        amountCents: input.code.amountCents,
        basePriceCents: input.code.amountCents,
        productSlugSnapshot: input.code.trafficPackProduct?.slug,
        productNameSnapshot:
          input.code.trafficPackProduct?.name ?? input.code.label,
        trafficBytes: input.code.trafficBytes,
        validityDays: input.code.trafficPackProduct?.validityDays,
        entitlementExpiresAt: expiresAt,
        accessProfileIdSnapshot: product.accessProfileId,
        note: input.code.note || `Redeemed ${input.code.code}`,
        processedAt: input.redeemedAt,
      },
      include: {
        user: true,
        processedBy: true,
        plan: true,
        trafficPackProduct: true,
      },
    });

    await tx.trafficPack.create({
      data: {
        userId: input.userId,
        accessAccountId: account.id,
        trafficPackProductId: product.id,
        accessProfileId: product.accessProfileId,
        label: input.code.label,
        totalBytes: input.code.trafficBytes,
        remainingBytes: input.code.trafficBytes,
        status: TrafficPackStatus.ACTIVE,
        expiresAt,
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
    const submittedTokenPreview = this.previewToken(input.tokenValue);
    const normalizedRemoteAddr =
      reason === 'token_not_found'
        ? (remoteHost(input.remoteAddr) ?? input.remoteAddr)
        : input.remoteAddr;

    if (reason === 'token_not_found') {
      const recentDuplicate = await this.prisma.authEvent.findFirst({
        where: {
          reason,
          granted: false,
          nodeId: nodeId ?? null,
          remoteAddr: normalizedRemoteAddr ?? null,
          submittedTokenPreview,
          createdAt: {
            gte: new Date(Date.now() - rejectedAuthDedupeMs),
          },
        },
        select: { id: true },
      });

      if (recentDuplicate) {
        return { ok: false as const, reason };
      }
    }

    await this.recordAuthEvent({
      userId,
      accessTokenId,
      nodeId,
      granted: false,
      reason,
      remoteAddr: normalizedRemoteAddr,
      requestedTxBps: input.requestedTxBps,
      submittedTokenPreview,
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
      sessionVersion: user.sessionVersion,
      notes: user.notes,
      balanceCents: user.balanceCents,
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

  private presentTrafficPackProduct(
    product: Prisma.TrafficPackProductGetPayload<object>,
  ) {
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      active: product.active,
      trafficBytes: Number(product.trafficBytes),
      validityDays: product.validityDays,
      accessProfileId: product.accessProfileId,
      priceCents: product.priceCents,
      accent: product.accent,
      archivedAt: product.archivedAt?.toISOString() ?? null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
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
      catalogOfferId: order.catalogOfferId ?? null,
      trafficPackProductId: order.trafficPackProductId ?? null,
      trafficPackProductName: order.trafficPackProduct?.name ?? null,
      status: this.fromDbOrderStatus(order.status),
      kind: this.fromDbOrderKind(order.kind),
      source: order.source.toLowerCase(),
      amountCents: order.amountCents,
      basePriceCents: order.basePriceCents,
      discountCents: order.discountCents,
      currency: order.currency,
      productSlugSnapshot: order.productSlugSnapshot,
      productNameSnapshot: order.productNameSnapshot,
      durationDays: order.durationDays,
      validityDays: order.validityDays,
      trafficBytes:
        order.trafficBytes !== null && order.trafficBytes !== undefined
          ? Number(order.trafficBytes)
          : null,
      note: order.note,
      entitlementExpiresAt: order.entitlementExpiresAt?.toISOString() ?? null,
      idempotencyKey: order.idempotencyKey,
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
      catalogOfferId: code.catalogOfferId,
      catalogOfferName: code.catalogOffer
        ? `${code.catalogOffer.product.name} · ${code.catalogOffer.name}`
        : null,
      trafficPackProductId: code.trafficPackProductId,
      trafficPackProductName: code.trafficPackProduct?.name ?? null,
      trafficBytes:
        code.trafficBytes !== null && code.trafficBytes !== undefined
          ? Number(code.trafficBytes)
          : null,
      amountCents: code.amountCents,
      discountPercent: code.discountPercent,
      discountCents: code.discountCents,
      planMode: code.planMode.toLowerCase(),
      maxUses: code.maxUses,
      usedCount: code.usedCount,
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

  private async mustGetTrafficPackProductRecord(productId: string) {
    const product = await this.prisma.trafficPackProduct.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(`Unknown traffic pack product: ${productId}`);
    }
    return product;
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
    if (!subscription)
      throw new NotFoundException(`Unknown subscription: ${subscriptionId}`);
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

  private async requireActiveSubscriptionForTrafficPack(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
    now = new Date(),
  ) {
    const subscription = await tx.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
    });
    if (!subscription) {
      throw new BadRequestException('购买流量包前需要先开通有效套餐');
    }
    return subscription;
  }

  private async mustGetActiveSubscriptionRecordForUser(userId: string) {
    const subscription = await this.getActiveSubscriptionForUser(userId);
    if (!subscription)
      throw new NotFoundException(`No active subscription for user: ${userId}`);
    return subscription;
  }

  private async mustGetAccessTokenByUser(userId: string) {
    const token = await this.prisma.accessToken.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!token)
      throw new NotFoundException(`No access token for user: ${userId}`);
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
      where: {
        status: TrafficPackStatus.ACTIVE,
        expiresAt: { lte: new Date() },
      },
      data: { status: TrafficPackStatus.EXPIRED },
    });
  }

  private async expireRedemptionCodes() {
    await this.prisma.redemptionCode.updateMany({
      where: {
        status: RedemptionCodeStatus.ACTIVE,
        expiresAt: { lte: new Date() },
      },
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
    const chars = Array.from(
      bytes,
      (value) => alphabet[value % alphabet.length],
    );
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

  private addUtcMonthsClamped(anchor: Date, months: number) {
    const first = new Date(
      Date.UTC(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth() + months,
        1,
        anchor.getUTCHours(),
        anchor.getUTCMinutes(),
        anchor.getUTCSeconds(),
        anchor.getUTCMilliseconds(),
      ),
    );
    const lastDay = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
    first.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
    return first;
  }

  private buildTrafficPackExpiry(
    purchasedAt: Date,
    subscriptionEndsAt: Date,
    validityDays: number | null,
  ) {
    if (!validityDays) return subscriptionEndsAt;
    const productExpiry = this.buildSubscriptionEndDate(
      purchasedAt,
      validityDays,
    );
    return productExpiry.getTime() < subscriptionEndsAt.getTime()
      ? productExpiry
      : subscriptionEndsAt;
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
      throw new BadRequestException(
        'Plan has no bound nodes; add a node binding to this plan first',
      );
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

  private fromDbRedemptionCodeKind(kind: RedemptionCodeKind): CdkKind {
    switch (kind) {
      case RedemptionCodeKind.TRAFFIC_PACK:
        return 'traffic_pack';
      case RedemptionCodeKind.BALANCE:
        return 'balance';
      case RedemptionCodeKind.DISCOUNT:
        return 'discount';
      default:
        return 'plan';
    }
  }

  private toDbRedemptionCodeKind(kind: CdkKind) {
    switch (kind) {
      case 'traffic_pack':
        return RedemptionCodeKind.TRAFFIC_PACK;
      case 'balance':
        return RedemptionCodeKind.BALANCE;
      case 'discount':
        return RedemptionCodeKind.DISCOUNT;
      default:
        return RedemptionCodeKind.PLAN;
    }
  }

  private fromDbRedemptionCodeStatus(
    status: RedemptionCodeStatus,
  ): 'active' | 'redeemed' | 'void' | 'expired' {
    switch (status) {
      case RedemptionCodeStatus.REDEEMED:
        return 'redeemed';
      case RedemptionCodeStatus.VOID:
        return 'void';
      case RedemptionCodeStatus.EXPIRED:
        return 'expired';
      default:
        return 'active';
    }
  }

  private toDbRedemptionCodeStatus(status: 'active' | 'void') {
    return status === 'void'
      ? RedemptionCodeStatus.VOID
      : RedemptionCodeStatus.ACTIVE;
  }

  private withDefinedValues<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as Partial<T>;
  }

  async cleanupOldData(retentionDays: number) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const [snapshots, events] = await Promise.all([
      this.prisma.onlineSnapshot.deleteMany({
        where: { capturedAt: { lt: cutoff } },
      }),
      this.prisma.authEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
    ]);

    return {
      deletedSnapshots: snapshots.count,
      deletedAuthEvents: events.count,
    };
  }
}
