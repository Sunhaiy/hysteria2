import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingPeriod,
  CatalogProductKind,
  EntitlementGrantKind,
  EntitlementGrantStatus,
  Prisma,
  QuotaBucketKind,
  QuotaAdjustmentMode,
  SubscriptionStatus,
  TrafficPackStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { QuotaAdjustmentDto } from './entitlement.dto';

const multiplierScale = BigInt(10_000);

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  async grantFromOrder(
    input: { orderId: string; subscriptionId?: string; trafficPackId?: string },
    client: DbClient = this.prisma,
  ) {
    const order = await client.manualOrder.findUnique({
      where: { id: input.orderId },
      include: {
        catalogOffer: { include: { product: true } },
      },
    });
    if (!order?.catalogOffer || !order.catalogOffer.product.accessProfileId) {
      throw new BadRequestException(
        'Order is not linked to a V2 catalog offer',
      );
    }
    if (!order.entitlementExpiresAt) {
      throw new BadRequestException('Order entitlement expiry is required');
    }
    const account = await this.ensureAccessAccount(order.userId, client);
    const product = order.catalogOffer.product;
    const accessProfileId = product.accessProfileId;
    if (!accessProfileId) {
      throw new BadRequestException(
        'Catalog product access profile is missing',
      );
    }
    const profile = await client.accessProfile.findUniqueOrThrow({
      where: { id: accessProfileId },
    });
    const startsAt = order.processedAt ?? order.createdAt;
    const kind =
      product.kind === CatalogProductKind.PLAN
        ? EntitlementGrantKind.PLAN
        : EntitlementGrantKind.TRAFFIC_PACK;

    if (kind === EntitlementGrantKind.PLAN) {
      await client.entitlementGrant.updateMany({
        where: {
          userId: order.userId,
          kind: EntitlementGrantKind.PLAN,
          status: EntitlementGrantStatus.ACTIVE,
          legacySubscriptionId: input.subscriptionId
            ? { not: input.subscriptionId }
            : undefined,
        },
        data: { status: EntitlementGrantStatus.CANCELED, endsAt: startsAt },
      });
    }

    const existing = input.subscriptionId
      ? await client.entitlementGrant.findUnique({
          where: { legacySubscriptionId: input.subscriptionId },
        })
      : input.trafficPackId
        ? await client.entitlementGrant.findUnique({
            where: { legacyTrafficPackId: input.trafficPackId },
          })
        : null;
    const grant = existing
      ? await client.entitlementGrant.update({
          where: { id: existing.id },
          data: {
            productId: product.id,
            offerId: order.catalogOffer.id,
            status: EntitlementGrantStatus.ACTIVE,
            endsAt: order.entitlementExpiresAt,
            accessProfileId,
            speedUpMbpsSnapshot: profile.speedUpMbps,
            speedDownMbpsSnapshot: profile.speedDownMbps,
            deviceLimitSnapshot: profile.deviceLimit,
          },
        })
      : await client.entitlementGrant.create({
          data: {
            userId: order.userId,
            accessAccountId: account.id,
            productId: product.id,
            offerId: order.catalogOffer.id,
            legacySubscriptionId: input.subscriptionId,
            legacyTrafficPackId: input.trafficPackId,
            kind,
            startsAt,
            endsAt: order.entitlementExpiresAt,
            accessProfileId,
            speedUpMbpsSnapshot: profile.speedUpMbps,
            speedDownMbpsSnapshot: profile.speedDownMbps,
            deviceLimitSnapshot: profile.deviceLimit,
          },
        });
    const bounds =
      kind === EntitlementGrantKind.PLAN
        ? this.monthlyCycleBounds(
            existing?.startsAt ?? startsAt,
            order.entitlementExpiresAt,
            startsAt,
          )
        : { startsAt, endsAt: order.entitlementExpiresAt };
    await client.quotaBucket.upsert({
      where: {
        grantId_startsAt: { grantId: grant.id, startsAt: bounds.startsAt },
      },
      create: {
        grantId: grant.id,
        kind:
          kind === EntitlementGrantKind.PLAN
            ? QuotaBucketKind.PLAN_CYCLE
            : QuotaBucketKind.TRAFFIC_PACK,
        startsAt: bounds.startsAt,
        endsAt: bounds.endsAt,
        grantedBytes: order.catalogOffer.trafficBytes,
      },
      update: { endsAt: bounds.endsAt },
    });
    return grant;
  }

  async resolveAccess(userId: string, nodeId?: string) {
    await this.ensureV2CurrentBuckets(userId);
    const now = new Date();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      return { allowed: false, reason: 'user_not_active' as const, nodes: [] };
    }
    const grants = await this.prisma.entitlementGrant.findMany({
      where: {
        userId,
        status: EntitlementGrantStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      include: {
        quotaBuckets: {
          where: { startsAt: { lte: now }, endsAt: { gt: now } },
        },
        product: true,
        accessProfile: {
          include: {
            poolBindings: {
              include: {
                pool: {
                  include: {
                    members: {
                      include: { node: true },
                      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
                    },
                  },
                },
              },
              orderBy: { priority: 'asc' },
            },
            nodeBindings: {
              include: { node: true },
              orderBy: { priority: 'asc' },
            },
          },
        },
      },
      orderBy: { endsAt: 'asc' },
    });
    const usable = grants.filter((grant) =>
      grant.quotaBuckets.some(
        (bucket) => bucket.grantedBytes > bucket.consumedBytes,
      ),
    );
    const nodes = new Map<
      string,
      { id: string; label: string; priority: number; region: string | null }
    >();
    for (const grant of usable) {
      for (const binding of grant.accessProfile.poolBindings) {
        if (!binding.pool.active) continue;
        for (const member of binding.pool.members) {
          if (!member.node.active || member.node.lifecycleStatus !== 'ACTIVE') {
            continue;
          }
          const priority = binding.priority * 10000 + member.priority;
          const prior = nodes.get(member.node.id);
          if (!prior || priority < prior.priority) {
            nodes.set(member.node.id, {
              id: member.node.id,
              label: member.node.label,
              priority,
              region: member.node.region,
            });
          }
        }
      }
      if (grant.accessProfile.poolBindings.length === 0) {
        for (const binding of grant.accessProfile.nodeBindings) {
          if (
            !binding.node.active ||
            binding.node.lifecycleStatus !== 'ACTIVE'
          ) {
            continue;
          }
          nodes.set(binding.node.id, {
            id: binding.node.id,
            label: binding.node.label,
            priority: binding.priority,
            region: binding.node.region,
          });
        }
      }
    }
    const orderedNodes = [...nodes.values()].sort(
      (left, right) => left.priority - right.priority,
    );
    if (usable.length === 0 || (nodeId && !nodes.has(nodeId))) {
      return {
        allowed: false,
        reason:
          usable.length === 0
            ? ('traffic_exhausted' as const)
            : ('node_denied' as const),
        nodes: orderedNodes,
      };
    }
    return {
      allowed: true,
      reason: 'ok' as const,
      speedUpMbps: Math.max(
        ...usable.map((grant) => grant.speedUpMbpsSnapshot),
      ),
      speedDownMbps: Math.max(
        ...usable.map((grant) => grant.speedDownMbpsSnapshot),
      ),
      deviceLimit: Math.max(
        ...usable.map((grant) => grant.deviceLimitSnapshot),
      ),
      remainingBytes: Number(
        usable
          .flatMap((grant) => grant.quotaBuckets)
          .reduce(
            (total, bucket) =>
              total + (bucket.grantedBytes - bucket.consumedBytes),
            BigInt(0),
          ),
      ),
      nodes: orderedNodes,
      grants: usable.map((grant) => ({
        id: grant.id,
        kind: grant.kind.toLowerCase(),
        productName: grant.product.name,
        endsAt: grant.endsAt.toISOString(),
      })),
    };
  }

  applyUsageBatch(
    nodeId: string,
    batch: {
      id: string;
      claimedAt: string;
      traffic: Record<string, { tx: number; rx: number }>;
    },
  ) {
    return this.applyTrafficBatch(nodeId, batch);
  }

  async getAccountSummary(userId: string) {
    const account = await this.ensureAccessAccount(userId, this.prisma);
    await this.ensureCurrentCycles(userId);
    const now = new Date();
    const fresh = await this.prisma.accessAccount.findUniqueOrThrow({
      where: { id: account.id },
      include: {
        subscriptions: {
          include: {
            plan: true,
            planOffer: true,
            cycles: { orderBy: { startsAt: 'desc' }, take: 1 },
          },
          orderBy: { createdAt: 'desc' },
        },
        trafficPacks: {
          include: { trafficPackProduct: true, accessProfile: true },
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
        },
        quotaAdjustments: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });

    return {
      id: fresh.id,
      userId,
      trafficMultiplier: fresh.trafficMultiplierBasisPoints / 10_000,
      subscriptions: fresh.subscriptions.map((subscription) => {
        const cycle = subscription.cycles[0];
        return {
          id: subscription.id,
          planId: subscription.planId,
          planName: subscription.plan.name,
          planOfferId: subscription.planOfferId,
          offerName: subscription.planOffer?.name ?? null,
          billingPeriod:
            subscription.planOffer?.billingPeriod.toLowerCase() ?? 'legacy',
          status: subscription.status.toLowerCase(),
          startsAt: subscription.startsAt.toISOString(),
          endsAt: subscription.endsAt.toISOString(),
          currentCycle: cycle ? this.presentCycle(cycle) : null,
        };
      }),
      trafficPacks: fresh.trafficPacks.map((pack) => ({
        id: pack.id,
        label: pack.label,
        productId: pack.trafficPackProductId,
        productName: pack.trafficPackProduct?.name ?? null,
        accessProfileId: pack.accessProfileId,
        accessProfileName: pack.accessProfile?.name ?? null,
        totalBytes: Number(pack.totalBytes),
        remainingBytes: Number(pack.remainingBytes),
        status: this.effectivePackStatus(pack, now),
        expiresAt: pack.expiresAt?.toISOString() ?? null,
        createdAt: pack.createdAt.toISOString(),
      })),
      adjustments: fresh.quotaAdjustments.map((adjustment) => ({
        id: adjustment.id,
        subscriptionCycleId: adjustment.subscriptionCycleId,
        trafficPackId: adjustment.trafficPackId,
        mode: adjustment.mode.toLowerCase(),
        deltaBytes: Number(adjustment.deltaBytes),
        beforeRemainingBytes: Number(adjustment.beforeRemainingBytes),
        afterRemainingBytes: Number(adjustment.afterRemainingBytes),
        reason: adjustment.reason,
        actorId: adjustment.actorId,
        createdAt: adjustment.createdAt.toISOString(),
      })),
    };
  }

  async updateTrafficMultiplier(
    userId: string,
    multiplier: number,
    actorId: string,
  ) {
    const basisPoints = Math.round(multiplier * 10_000);
    if (basisPoints < 1_000 || basisPoints > 1_000_000) {
      throw new BadRequestException('Traffic multiplier must be 0.1 to 100');
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await this.ensureAccessAccount(userId, tx);
      const updated = await tx.accessAccount.update({
        where: { id: account.id },
        data: { trafficMultiplierBasisPoints: basisPoints },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'entitlement.traffic_multiplier.updated',
          targetType: 'access_account',
          targetId: account.id,
          metadata: {
            userId,
            before: account.trafficMultiplierBasisPoints / 10_000,
            after: basisPoints / 10_000,
          },
        },
      });
      return {
        id: updated.id,
        userId,
        trafficMultiplier: updated.trafficMultiplierBasisPoints / 10_000,
      };
    });
  }

  adjustSubscriptionQuota(
    subscriptionId: string,
    input: QuotaAdjustmentDto,
    actorId: string,
  ) {
    return this.serializable(async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true, planOffer: true },
      });
      if (!subscription) throw new NotFoundException('Subscription not found');
      const account = await this.ensureAccessAccount(subscription.userId, tx);
      if (!subscription.accessAccountId) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { accessAccountId: account.id },
        });
      }
      const cycle = await this.ensureCurrentCycleInTransaction(
        tx,
        subscription,
        new Date(),
      );
      if (!cycle) {
        throw new BadRequestException('Subscription has no active quota cycle');
      }
      const before = this.cycleRemaining(cycle);
      const delta = this.resolveAdjustmentDelta(input, before);
      const after = before + delta;
      if (after < BigInt(0)) {
        throw new BadRequestException('Adjustment would make quota negative');
      }
      const updated = await tx.subscriptionCycle.update({
        where: { id: cycle.id },
        data: { adjustmentBytes: { increment: delta } },
      });
      const adjustment = await tx.quotaAdjustment.create({
        data: {
          accessAccountId: account.id,
          subscriptionCycleId: cycle.id,
          actorId,
          mode: this.toAdjustmentMode(input.mode),
          deltaBytes: delta,
          beforeRemainingBytes: before,
          afterRemainingBytes: after,
          reason: input.reason.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'entitlement.subscription_quota.adjusted',
          targetType: 'subscription',
          targetId: subscription.id,
          metadata: {
            adjustmentId: adjustment.id,
            cycleId: cycle.id,
            deltaBytes: delta.toString(),
            afterRemainingBytes: after.toString(),
          },
        },
      });
      return { adjustmentId: adjustment.id, cycle: this.presentCycle(updated) };
    });
  }

  adjustTrafficPackQuota(
    trafficPackId: string,
    input: QuotaAdjustmentDto,
    actorId: string,
  ) {
    return this.serializable(async (tx) => {
      const pack = await tx.trafficPack.findUnique({
        where: { id: trafficPackId },
      });
      if (!pack) throw new NotFoundException('Traffic entitlement not found');
      const account = await this.ensureAccessAccount(pack.userId, tx);
      const before = pack.remainingBytes;
      const delta = this.resolveAdjustmentDelta(input, before);
      const after = before + delta;
      if (after < BigInt(0)) {
        throw new BadRequestException('Adjustment would make quota negative');
      }
      const updated = await tx.trafficPack.update({
        where: { id: pack.id },
        data: {
          accessAccountId: account.id,
          remainingBytes: after,
          totalBytes: delta > BigInt(0) ? { increment: delta } : undefined,
          status:
            after === BigInt(0)
              ? TrafficPackStatus.EXHAUSTED
              : TrafficPackStatus.ACTIVE,
        },
      });
      const adjustment = await tx.quotaAdjustment.create({
        data: {
          accessAccountId: account.id,
          trafficPackId: pack.id,
          actorId,
          mode: this.toAdjustmentMode(input.mode),
          deltaBytes: delta,
          beforeRemainingBytes: before,
          afterRemainingBytes: after,
          reason: input.reason.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'entitlement.traffic_pack_quota.adjusted',
          targetType: 'traffic_pack',
          targetId: pack.id,
          metadata: {
            adjustmentId: adjustment.id,
            deltaBytes: delta.toString(),
            afterRemainingBytes: after.toString(),
          },
        },
      });
      return {
        adjustmentId: adjustment.id,
        trafficPack: {
          id: updated.id,
          remainingBytes: Number(updated.remainingBytes),
          totalBytes: Number(updated.totalBytes),
          status: updated.status.toLowerCase(),
        },
      };
    });
  }

  async applyTrafficBatch(
    nodeId: string,
    batch: {
      id: string;
      claimedAt: string;
      traffic: Record<string, { tx: number; rx: number }>;
    },
  ) {
    const claimedAt = this.validateTrafficBatch(batch);
    return this.serializable(async (tx) => {
      const existing = await tx.usageImportBatch.findUnique({
        where: { nodeId_externalId: { nodeId, externalId: batch.id } },
      });
      if (existing) {
        return { replayed: true, impactedUsers: Object.keys(batch.traffic) };
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
        if (
          await this.applyUserTraffic(
            tx,
            nodeId,
            userId,
            counters,
            imported.id,
            claimedAt,
          )
        ) {
          impactedUsers.push(userId);
        }
      }
      return { replayed: false, impactedUsers };
    });
  }

  async getNodeAccess(userId: string, nodeId: string) {
    const v2GrantCount = await this.prisma.entitlementGrant.count({
      where: { userId },
    });
    if (v2GrantCount > 0) {
      return this.resolveAccess(userId, nodeId);
    }
    await this.ensureCurrentCycles(userId);
    const now = new Date();
    const [user, packs, subscriptions] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.trafficPack.findMany({
        where: {
          userId,
          status: TrafficPackStatus.ACTIVE,
          remainingBytes: { gt: BigInt(0) },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          AND: [
            {
              OR: [
                {
                  accessProfile: {
                    active: true,
                    nodeBindings: { some: { nodeId, node: { active: true } } },
                  },
                },
                { accessProfileId: null, subscription: { nodeId } },
              ],
            },
          ],
        },
        include: { accessProfile: true, subscription: true },
      }),
      this.prisma.subscription.findMany({
        where: {
          userId,
          status: SubscriptionStatus.ACTIVE,
          startsAt: { lte: now },
          endsAt: { gt: now },
          OR: [
            { nodeId },
            {
              plan: {
                accessProfile: {
                  active: true,
                  nodeBindings: { some: { nodeId, node: { active: true } } },
                },
              },
            },
          ],
        },
        include: {
          plan: { include: { accessProfile: true } },
          cycles: {
            where: { startsAt: { lte: now }, endsAt: { gt: now } },
            take: 1,
          },
        },
      }),
    ]);
    if (!user || user.status !== UserStatus.ACTIVE) {
      return { allowed: false, reason: 'user_not_active' as const };
    }
    const usableSubscriptions = subscriptions.filter((subscription) => {
      const cycle = subscription.cycles[0];
      return cycle && this.cycleRemaining(cycle) > BigInt(0);
    });
    if (packs.length === 0 && usableSubscriptions.length === 0) {
      return { allowed: false, reason: 'traffic_exhausted' as const };
    }
    const limits = [
      ...packs.map((pack) => ({
        speedUpMbps:
          pack.accessProfile?.speedUpMbps ??
          pack.subscription?.speedUpMbpsSnapshot ??
          0,
        speedDownMbps:
          pack.accessProfile?.speedDownMbps ??
          pack.subscription?.speedDownMbpsSnapshot ??
          0,
        deviceLimit:
          pack.accessProfile?.deviceLimit ??
          pack.subscription?.deviceLimitSnapshot ??
          1,
      })),
      ...usableSubscriptions.map((subscription) => ({
        speedUpMbps:
          subscription.plan.accessProfile?.speedUpMbps ??
          subscription.speedUpMbpsSnapshot,
        speedDownMbps:
          subscription.plan.accessProfile?.speedDownMbps ??
          subscription.speedDownMbpsSnapshot,
        deviceLimit:
          subscription.plan.accessProfile?.deviceLimit ??
          subscription.deviceLimitSnapshot,
      })),
    ];
    return {
      allowed: true,
      reason: 'ok' as const,
      speedUpMbps: Math.max(...limits.map((item) => item.speedUpMbps)),
      speedDownMbps: Math.max(...limits.map((item) => item.speedDownMbps)),
      deviceLimit: Math.max(...limits.map((item) => item.deviceLimit)),
    };
  }

  async getNodeProvisioningUsers(nodeId: string) {
    const tokens = await this.prisma.accessToken.findMany({
      where: { revokedAt: null, user: { status: UserStatus.ACTIVE } },
      distinct: ['userId'],
      orderBy: { createdAt: 'asc' },
      select: { userId: true, vlessUuid: true },
    });
    const decisions = await Promise.all(
      tokens.map(async (token) => ({
        token,
        access: await this.getNodeAccess(token.userId, nodeId),
      })),
    );
    return decisions
      .filter((item) => item.access.allowed)
      .map((item) => ({ userId: item.token.userId, id: item.token.vlessUuid }));
  }

  private async applyUserTraffic(
    tx: Prisma.TransactionClient,
    nodeId: string,
    userId: string,
    counters: { tx: number; rx: number },
    importBatchId: string,
    bucketStart: Date,
  ) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return false;
    const account = await this.ensureAccessAccount(userId, tx);
    const physical = BigInt(counters.tx) + BigInt(counters.rx);
    const scaled =
      physical * BigInt(account.trafficMultiplierBasisPoints) +
      BigInt(account.trafficMultiplierRemainder);
    const accounted = scaled / multiplierScale;
    const remainder = Number(scaled % multiplierScale);
    await tx.accessAccount.update({
      where: { id: account.id },
      data: { trafficMultiplierRemainder: remainder },
    });

    let remaining = accounted;
    const v2Buckets = await tx.quotaBucket.findMany({
      where: {
        startsAt: { lte: bucketStart },
        endsAt: { gt: bucketStart },
        grant: {
          accessAccountId: account.id,
          status: EntitlementGrantStatus.ACTIVE,
          startsAt: { lte: bucketStart },
          endsAt: { gt: bucketStart },
          accessProfile: {
            active: true,
            OR: [
              {
                poolBindings: {
                  some: {
                    pool: {
                      active: true,
                      members: {
                        some: {
                          nodeId,
                          node: { active: true, lifecycleStatus: 'ACTIVE' },
                        },
                      },
                    },
                  },
                },
              },
              {
                nodeBindings: {
                  some: {
                    nodeId,
                    node: { active: true, lifecycleStatus: 'ACTIVE' },
                  },
                },
              },
            ],
          },
        },
      },
      include: {
        grant: {
          select: { legacySubscriptionId: true, legacyTrafficPackId: true },
        },
      },
      orderBy: [{ endsAt: 'asc' }, { createdAt: 'asc' }],
    });
    const usableV2Buckets = v2Buckets.filter(
      (bucket) => bucket.grantedBytes > bucket.consumedBytes,
    );
    if (usableV2Buckets.length > 0) {
      const allocations: Array<{
        quotaBucketId: string;
        accountedBytes: bigint;
      }> = [];
      let subscriptionId: string | undefined;
      let subscriptionCycleId: string | undefined;
      for (const bucket of usableV2Buckets) {
        if (remaining === BigInt(0)) break;
        const available = bucket.grantedBytes - bucket.consumedBytes;
        const consumed = available < remaining ? available : remaining;
        await tx.quotaBucket.update({
          where: { id: bucket.id },
          data: { consumedBytes: { increment: consumed } },
        });
        allocations.push({
          quotaBucketId: bucket.id,
          accountedBytes: consumed,
        });
        remaining -= consumed;

        if (bucket.grant.legacyTrafficPackId) {
          const pack = await tx.trafficPack.findUnique({
            where: { id: bucket.grant.legacyTrafficPackId },
          });
          if (pack) {
            const next =
              pack.remainingBytes > consumed
                ? pack.remainingBytes - consumed
                : BigInt(0);
            await tx.trafficPack.update({
              where: { id: pack.id },
              data: {
                remainingBytes: next,
                status:
                  next === BigInt(0)
                    ? TrafficPackStatus.EXHAUSTED
                    : TrafficPackStatus.ACTIVE,
              },
            });
          }
        }
        if (bucket.grant.legacySubscriptionId) {
          subscriptionId = bucket.grant.legacySubscriptionId;
          const cycle = await tx.subscriptionCycle.findFirst({
            where: {
              subscriptionId,
              startsAt: { lte: bucketStart },
              endsAt: { gt: bucketStart },
            },
          });
          if (cycle) {
            subscriptionCycleId = cycle.id;
            const updated = await tx.subscriptionCycle.update({
              where: { id: cycle.id },
              data: { consumedBytes: { increment: consumed } },
            });
            await tx.subscription.update({
              where: { id: subscriptionId },
              data: { consumedTrafficBytes: updated.consumedBytes },
            });
          }
        }
      }
      await tx.usageRollup.create({
        data: {
          userId,
          subscriptionId,
          subscriptionCycleId,
          nodeId,
          bucketStart,
          txBytes: BigInt(counters.tx),
          rxBytes: BigInt(counters.rx),
          accountedBytes: accounted,
          overageBytes: remaining,
          source: 'sync-v2',
          importBatchId,
          allocations: { create: allocations },
        },
      });
      return true;
    }

    const now = bucketStart;
    const packs = await tx.trafficPack.findMany({
      where: {
        accessAccountId: account.id,
        status: TrafficPackStatus.ACTIVE,
        remainingBytes: { gt: BigInt(0) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [
          {
            OR: [
              {
                accessProfile: {
                  active: true,
                  nodeBindings: { some: { nodeId, node: { active: true } } },
                },
              },
              { accessProfileId: null, subscription: { nodeId } },
            ],
          },
        ],
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });
    for (const pack of packs) {
      if (remaining === BigInt(0)) break;
      const consumed =
        pack.remainingBytes < remaining ? pack.remainingBytes : remaining;
      const next = pack.remainingBytes - consumed;
      await tx.trafficPack.update({
        where: { id: pack.id },
        data: {
          remainingBytes: next,
          status:
            next === BigInt(0)
              ? TrafficPackStatus.EXHAUSTED
              : TrafficPackStatus.ACTIVE,
        },
      });
      remaining -= consumed;
    }

    const subscription = await tx.subscription.findFirst({
      where: {
        accessAccountId: account.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [
          { nodeId },
          {
            plan: {
              accessProfile: {
                active: true,
                nodeBindings: { some: { nodeId, node: { active: true } } },
              },
            },
          },
        ],
      },
      include: { plan: true, planOffer: true },
      orderBy: { endsAt: 'desc' },
    });
    let cycle = subscription
      ? await this.ensureCurrentCycleInTransaction(tx, subscription, now)
      : null;
    if (remaining > BigInt(0) && cycle) {
      const available = this.cycleRemaining(cycle);
      const consumed = available < remaining ? available : remaining;
      cycle = await tx.subscriptionCycle.update({
        where: { id: cycle.id },
        data: { consumedBytes: { increment: consumed } },
      });
      await tx.subscription.update({
        where: { id: subscription!.id },
        data: {
          includedTrafficBytes: cycle.grantedBytes + cycle.adjustmentBytes,
          bonusTrafficBytes: BigInt(0),
          consumedTrafficBytes: cycle.consumedBytes,
        },
      });
      remaining -= consumed;
    }
    if (remaining > BigInt(0) && cycle) {
      cycle = await tx.subscriptionCycle.update({
        where: { id: cycle.id },
        data: { overageBytes: { increment: remaining } },
      });
    }

    await tx.usageRollup.create({
      data: {
        userId,
        subscriptionId: subscription?.id,
        subscriptionCycleId: cycle?.id,
        nodeId,
        bucketStart,
        txBytes: BigInt(counters.tx),
        rxBytes: BigInt(counters.rx),
        accountedBytes: accounted,
        overageBytes: remaining,
        source: 'sync',
        importBatchId,
      },
    });
    return true;
  }

  private async ensureCurrentCycles(userId: string) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: new Date() },
        endsAt: { gt: new Date() },
      },
      include: { plan: true, planOffer: true },
    });
    for (const subscription of subscriptions) {
      await this.serializable((tx) =>
        this.ensureCurrentCycleInTransaction(tx, subscription, new Date()),
      );
    }
  }

  private async ensureV2CurrentBuckets(userId: string) {
    const now = new Date();
    const grants = await this.prisma.entitlementGrant.findMany({
      where: {
        userId,
        kind: EntitlementGrantKind.PLAN,
        status: EntitlementGrantStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      include: { offer: true },
    });
    for (const grant of grants) {
      if (!grant.offer) continue;
      const bounds = this.monthlyCycleBounds(grant.startsAt, grant.endsAt, now);
      await this.prisma.quotaBucket.upsert({
        where: {
          grantId_startsAt: { grantId: grant.id, startsAt: bounds.startsAt },
        },
        create: {
          grantId: grant.id,
          kind: QuotaBucketKind.PLAN_CYCLE,
          startsAt: bounds.startsAt,
          endsAt: bounds.endsAt,
          grantedBytes: grant.offer.trafficBytes,
        },
        update: {},
      });
    }
  }

  private async ensureCurrentCycleInTransaction(
    tx: Prisma.TransactionClient,
    subscription: {
      id: string;
      startsAt: Date;
      endsAt: Date;
      includedTrafficBytes: bigint;
      bonusTrafficBytes: bigint;
      consumedTrafficBytes: bigint;
      plan: { trafficBytes: bigint };
      planOffer: {
        billingPeriod: BillingPeriod;
        intervalMonths: number | null;
      } | null;
    },
    now: Date,
  ) {
    const existing = await tx.subscriptionCycle.findFirst({
      where: {
        subscriptionId: subscription.id,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { startsAt: 'desc' },
    });
    if (existing) return existing;
    if (now < subscription.startsAt || now >= subscription.endsAt) return null;

    if (
      !subscription.planOffer ||
      subscription.planOffer.billingPeriod === BillingPeriod.LEGACY
    ) {
      return tx.subscriptionCycle.create({
        data: {
          subscriptionId: subscription.id,
          startsAt: subscription.startsAt,
          endsAt: subscription.endsAt,
          grantedBytes:
            subscription.includedTrafficBytes + subscription.bonusTrafficBytes,
          consumedBytes: subscription.consumedTrafficBytes,
          legacy: true,
        },
      });
    }

    const { startsAt, endsAt } = this.monthlyCycleBounds(
      subscription.startsAt,
      subscription.endsAt,
      now,
    );
    return tx.subscriptionCycle.upsert({
      where: {
        subscriptionId_startsAt: {
          subscriptionId: subscription.id,
          startsAt,
        },
      },
      create: {
        subscriptionId: subscription.id,
        startsAt,
        endsAt,
        grantedBytes: subscription.plan.trafficBytes,
      },
      update: {},
    });
  }

  private monthlyCycleBounds(anchor: Date, entitlementEnd: Date, now: Date) {
    let offset =
      (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      anchor.getUTCMonth();
    let startsAt = this.addUtcMonthsClamped(anchor, offset);
    if (startsAt > now) {
      offset -= 1;
      startsAt = this.addUtcMonthsClamped(anchor, offset);
    }
    let endsAt = this.addUtcMonthsClamped(anchor, offset + 1);
    if (endsAt > entitlementEnd) endsAt = entitlementEnd;
    return { startsAt, endsAt };
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

  private async ensureAccessAccount(userId: string, client: DbClient) {
    const user = await client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return client.accessAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private cycleRemaining(cycle: {
    grantedBytes: bigint;
    adjustmentBytes: bigint;
    consumedBytes: bigint;
  }) {
    const value =
      cycle.grantedBytes + cycle.adjustmentBytes - cycle.consumedBytes;
    return value > BigInt(0) ? value : BigInt(0);
  }

  private presentCycle(cycle: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    grantedBytes: bigint;
    adjustmentBytes: bigint;
    consumedBytes: bigint;
    overageBytes: bigint;
    legacy: boolean;
  }) {
    return {
      id: cycle.id,
      startsAt: cycle.startsAt.toISOString(),
      endsAt: cycle.endsAt.toISOString(),
      grantedBytes: Number(cycle.grantedBytes),
      adjustmentBytes: Number(cycle.adjustmentBytes),
      consumedBytes: Number(cycle.consumedBytes),
      remainingBytes: Number(this.cycleRemaining(cycle)),
      overageBytes: Number(cycle.overageBytes),
      legacy: cycle.legacy,
    };
  }

  private resolveAdjustmentDelta(input: QuotaAdjustmentDto, before: bigint) {
    if (input.mode === 'delta') {
      if (input.bytes === undefined || !Number.isSafeInteger(input.bytes)) {
        throw new BadRequestException('bytes is required for delta adjustment');
      }
      return BigInt(input.bytes);
    }
    if (
      input.remainingBytes === undefined ||
      !Number.isSafeInteger(input.remainingBytes) ||
      input.remainingBytes < 0
    ) {
      throw new BadRequestException(
        'remainingBytes is required for set_remaining adjustment',
      );
    }
    return BigInt(input.remainingBytes) - before;
  }

  private toAdjustmentMode(mode: QuotaAdjustmentDto['mode']) {
    return mode === 'delta'
      ? QuotaAdjustmentMode.DELTA
      : QuotaAdjustmentMode.SET_REMAINING;
  }

  private validateTrafficBatch(batch: {
    id: string;
    claimedAt: string;
    traffic: Record<string, { tx: number; rx: number }>;
  }) {
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
    return claimedAt;
  }

  private effectivePackStatus(
    pack: { status: TrafficPackStatus; expiresAt: Date | null },
    now: Date,
  ) {
    if (pack.expiresAt && pack.expiresAt <= now) return 'expired';
    return pack.status.toLowerCase();
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === 2) throw error;
      }
    }
    throw new ConflictException('Concurrent entitlement update failed');
  }
}
