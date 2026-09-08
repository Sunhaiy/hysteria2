import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import {
  EpayPaymentStatus,
  Prisma,
  SubscriptionStatus,
  TrafficPackStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CustomerQuotaOperationDto } from './customer-admin.dto';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';
import { apiPublicUrl } from '../common/public-url';
import {
  CustomerTrafficService,
  type DailyTrafficQuery,
} from './customer-traffic.service';
import { postWalletEntry } from '../wallet/wallet-ledger';
import { EntitlementService } from '../entitlement/entitlement.service';
import { closeGroupBuyParticipationForAccountDeletion } from '../group-buy/group-buy-account-cleanup';

export interface CustomerQuery extends PageQuery {
  q?: string;
  status?: string;
  role?: string;
  planId?: string;
  entitlementKind?: string;
  quotaState?: string;
  online?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: string;
  subscriptionHistory?: string;
}

export interface SubscriptionQuery extends PageQuery {
  q?: string;
  status?: string;
  planId?: string;
  nodeId?: string;
  billingPeriod?: string;
  quotaState?: string;
  expiresFrom?: string;
  expiresTo?: string;
  sort?: string;
}

@Injectable()
export class CustomerAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerTraffic: CustomerTrafficService,
    private readonly entitlements: EntitlementService,
  ) {}

  async searchOptions(query: Pick<CustomerQuery, 'q' | 'pageSize'>) {
    const q = query.q?.trim();
    const pageSize = Math.min(parsePage(query).pageSize, 20);
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        role: UserRole.MEMBER,
        status: UserStatus.ACTIVE,
        OR: q
          ? [
              { email: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ]
          : undefined,
      },
      select: { id: true, email: true, displayName: true },
      orderBy: [{ email: 'asc' }, { id: 'asc' }],
      take: pageSize,
    });
  }

  async listUsers(query: CustomerQuery) {
    const now = new Date();
    const { page, pageSize, skip } = parsePage(query);
    const where: Prisma.UserWhereInput = { deletedAt: null };
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (query.status) where.status = this.userStatus(query.status);
    if (query.role) where.role = this.userRole(query.role);
    if (query.planId) {
      where.subscriptions = {
        some: {
          planId: query.planId,
          status: SubscriptionStatus.ACTIVE,
          endsAt: { gt: now },
        },
      };
    }
    if (query.entitlementKind === 'plan' && !query.planId) {
      where.subscriptions = {
        some: { status: SubscriptionStatus.ACTIVE, endsAt: { gt: now } },
      };
    } else if (query.entitlementKind === 'traffic_pack') {
      where.trafficPacks = {
        some: {
          status: TrafficPackStatus.ACTIVE,
          remainingBytes: { gt: BigInt(0) },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      };
    }
    if (
      query.subscriptionHistory &&
      !['ever', 'never'].includes(query.subscriptionHistory)
    ) {
      throw new BadRequestException('Invalid subscription history filter');
    }
    if (query.subscriptionHistory) {
      const hasSubscriptionHistory: Prisma.UserWhereInput = {
        OR: [
          { subscriptions: { some: {} } },
          { entitlementGrants: { some: { kind: 'PLAN' } } },
        ],
      };
      where.AND = [
        ...(Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : []),
        query.subscriptionHistory === 'ever'
          ? hasSubscriptionHistory
          : { NOT: hasSubscriptionHistory },
      ];
    }
    const createdAt: Prisma.DateTimeFilter = {};
    const createdFrom = this.validDate(query.createdFrom);
    const createdTo = this.validDate(query.createdTo);
    if (createdFrom) createdAt.gte = createdFrom;
    if (createdTo) createdAt.lte = createdTo;
    if (createdFrom || createdTo) where.createdAt = createdAt;
    if (query.online === 'true' || query.online === 'false') {
      const onlineFilter: Prisma.UserWhereInput = {
        onlinePresence: {
          some: {
            concurrentClients: { gt: 0 },
            observedAt: { gte: new Date(now.getTime() - 45_000) },
          },
        },
      };
      if (query.online === 'true') {
        Object.assign(where, onlineFilter);
      } else {
        where.NOT = onlineFilter;
      }
    }
    if (query.quotaState) {
      const ids = await this.userIdsForQuotaState(query.quotaState, now);
      where.id = { in: ids };
    }

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          accessTokens: {
            where: { revokedAt: null },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
          accessAccount: true,
          subscriptions: {
            where: {
              entitlementGrant: null,
              status: SubscriptionStatus.ACTIVE,
              endsAt: { gt: now },
            },
            include: {
              plan: true,
              cycles: {
                where: { startsAt: { lte: now }, endsAt: { gt: now } },
                take: 1,
              },
            },
          },
          trafficPacks: {
            where: {
              entitlementGrant: null,
              status: TrafficPackStatus.ACTIVE,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            include: {
              trafficPackProduct: { include: { catalogProduct: true } },
            },
          },
          entitlementGrants: {
            where: {
              status: 'ACTIVE',
              startsAt: { lte: now },
              endsAt: { gt: now },
            },
            include: {
              product: true,
              quotaBuckets: {
                where: { startsAt: { lte: now }, endsAt: { gt: now } },
              },
            },
          },
          onlinePresence: {
            where: {
              concurrentClients: { gt: 0 },
              observedAt: { gte: new Date(now.getTime() - 45_000) },
            },
            select: { concurrentClients: true, observedAt: true },
          },
        },
        orderBy:
          query.sort === 'created_asc'
            ? [{ createdAt: 'asc' }, { id: 'asc' }]
            : query.sort === 'email_asc'
              ? [{ email: 'asc' }, { id: 'asc' }]
              : [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    const presented = rows.map((user) => {
      const planRemaining = user.subscriptions.reduce((total, subscription) => {
        const cycle = subscription.cycles[0];
        return (
          total +
          (cycle
            ? this.remaining(
                cycle.grantedBytes + cycle.adjustmentBytes,
                cycle.consumedBytes,
              )
            : this.remaining(
                subscription.includedTrafficBytes +
                  subscription.bonusTrafficBytes,
                subscription.consumedTrafficBytes,
              ))
        );
      }, 0);
      const packRemaining = user.trafficPacks.reduce(
        (total, pack) => total + Number(pack.remainingBytes),
        0,
      );
      const v2Remaining = user.entitlementGrants.reduce(
        (grantTotal, grant) =>
          grantTotal +
          grant.quotaBuckets.reduce(
            (bucketTotal, bucket) =>
              bucketTotal +
              this.remaining(bucket.grantedBytes, bucket.consumedBytes),
            0,
          ),
        0,
      );
      const remainingBytes = v2Remaining + planRemaining + packRemaining;
      const entitlementMultiplierBasisPoints = Math.max(
        user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000,
        ...user.entitlementGrants.flatMap((grant) =>
          grant.quotaBuckets
            .filter((bucket) => bucket.grantedBytes > bucket.consumedBytes)
            .map(
              (bucket) =>
                bucket.trafficMultiplierBasisPointsSnapshot ??
                grant.trafficMultiplierBasisPointsSnapshot ??
                10_000,
            ),
        ),
        ...user.trafficPacks
          .filter((pack) => pack.remainingBytes > BigInt(0))
          .map(
            (pack) =>
              pack.trafficPackProduct?.catalogProduct
                ?.defaultTrafficMultiplierBasisPoints ??
              user.accessAccount?.trafficMultiplierBasisPoints ??
              10_000,
          ),
      );
      const activePlanNames = [
        ...new Set([
          ...user.entitlementGrants
            .filter((grant) => grant.kind === 'PLAN')
            .map((grant) => grant.product.name),
          ...user.subscriptions.map((item) => item.plan.name),
        ]),
      ];
      const activeTrafficPackCount =
        user.entitlementGrants.filter((grant) => grant.kind === 'TRAFFIC_PACK')
          .length + user.trafficPacks.length;
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role.toLowerCase(),
        status: user.status.toLowerCase(),
        notes: user.notes,
        balanceCents: user.balanceCents,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        primaryAccessTokenPreview: user.accessTokens[0]
          ? this.previewToken(user.accessTokens[0].token)
          : null,
        primaryAccessTokenLastUsedAt:
          user.accessTokens[0]?.lastUsedAt?.toISOString() ?? null,
        trafficMultiplier:
          Math.max(
            entitlementMultiplierBasisPoints,
            user.accessAccount?.trafficMultiplierOverrideBasisPoints ?? 10_000,
          ) / 10_000,
        remainingBytes,
        activePlanNames,
        activeTrafficPackCount,
        quotaState: this.quotaState(remainingBytes),
        onlineClients: user.onlinePresence.reduce(
          (total, item) => total + item.concurrentClients,
          0,
        ),
        online: user.onlinePresence.length > 0,
      };
    });
    return pageResponse(presented, total, page, pageSize);
  }

  async listSubscriptions(query: SubscriptionQuery) {
    const { page, pageSize, skip } = parsePage(query);
    const where: Prisma.SubscriptionWhereInput = {};
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
        { user: { displayName: { contains: q, mode: 'insensitive' } } },
      ];
    }
    if (query.status) where.status = this.subscriptionStatus(query.status);
    if (query.planId) where.planId = query.planId;
    if (query.nodeId) where.nodeId = query.nodeId;
    if (query.billingPeriod) {
      where.planOffer = {
        billingPeriod: query.billingPeriod.toUpperCase() as never,
      };
    }
    const endsAt: Prisma.DateTimeFilter = {};
    const expiresFrom = this.validDate(query.expiresFrom);
    const expiresTo = this.validDate(query.expiresTo);
    if (expiresFrom) endsAt.gte = expiresFrom;
    if (expiresTo) endsAt.lte = expiresTo;
    if (expiresFrom || expiresTo) where.endsAt = endsAt;
    if (query.quotaState) {
      const ids = await this.subscriptionIdsForQuotaState(query.quotaState);
      where.id = { in: ids };
    }

    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: {
          user: true,
          plan: true,
          planOffer: true,
          node: true,
          accessAccount: true,
          cycles: { orderBy: { startsAt: 'desc' }, take: 1 },
        },
        orderBy:
          query.sort === 'expires_asc'
            ? [{ endsAt: 'asc' }, { id: 'asc' }]
            : query.sort === 'created_asc'
              ? [{ createdAt: 'asc' }, { id: 'asc' }]
              : [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    const presented = rows.map((subscription) => {
      const cycle = subscription.cycles[0];
      const granted = cycle
        ? cycle.grantedBytes + cycle.adjustmentBytes
        : subscription.includedTrafficBytes + subscription.bonusTrafficBytes;
      const consumed = cycle
        ? cycle.consumedBytes
        : subscription.consumedTrafficBytes;
      const remainingBytes = this.remaining(granted, consumed);
      return {
        id: subscription.id,
        userId: subscription.userId,
        userEmail: subscription.user.email,
        userDisplayName: subscription.user.displayName,
        planId: subscription.planId,
        planName: subscription.plan.name,
        planOfferId: subscription.planOfferId,
        offerName: subscription.planOffer?.name ?? null,
        billingPeriod:
          subscription.planOffer?.billingPeriod.toLowerCase() ?? 'legacy',
        nodeId: subscription.nodeId,
        nodeLabel: subscription.node.label,
        status: subscription.status.toLowerCase(),
        startsAt: subscription.startsAt.toISOString(),
        endsAt: subscription.endsAt.toISOString(),
        includedTrafficBytes: Number(granted),
        bonusTrafficBytes: 0,
        consumedTrafficBytes: Number(consumed),
        trafficRemainingBytes: remainingBytes,
        trafficMultiplier:
          Math.max(
            subscription.accessAccount?.trafficMultiplierBasisPoints ?? 10_000,
            subscription.accessAccount?.trafficMultiplierOverrideBasisPoints ??
              10_000,
          ) / 10_000,
        quotaState: this.quotaState(remainingBytes),
        speedUpMbpsSnapshot: subscription.speedUpMbpsSnapshot,
        speedDownMbpsSnapshot: subscription.speedDownMbpsSnapshot,
        deviceLimitSnapshot: subscription.deviceLimitSnapshot,
        currentCycle: cycle
          ? {
              id: cycle.id,
              startsAt: cycle.startsAt.toISOString(),
              endsAt: cycle.endsAt.toISOString(),
              overageBytes: Number(cycle.overageBytes),
            }
          : null,
        createdAt: subscription.createdAt.toISOString(),
        updatedAt: subscription.updatedAt.toISOString(),
      };
    });
    return pageResponse(presented, total, page, pageSize);
  }

  async getCustomer(id: string) {
    const now = new Date();
    const [user, recentTraffic] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id },
        include: {
          accessAccount: true,
          entitlementGrants: {
            where: {
              status: 'ACTIVE',
              startsAt: { lte: now },
              endsAt: { gt: now },
            },
            include: {
              quotaBuckets: {
                where: { startsAt: { lte: now }, endsAt: { gt: now } },
                select: {
                  grantedBytes: true,
                  consumedBytes: true,
                  trafficMultiplierBasisPointsSnapshot: true,
                },
              },
            },
          },
          subscriptions: {
            where: {
              entitlementGrant: null,
              status: SubscriptionStatus.ACTIVE,
              startsAt: { lte: now },
              endsAt: { gt: now },
            },
            include: {
              cycles: {
                where: { startsAt: { lte: now }, endsAt: { gt: now } },
                take: 1,
              },
            },
          },
          trafficPacks: {
            where: {
              entitlementGrant: null,
              status: TrafficPackStatus.ACTIVE,
              remainingBytes: { gt: BigInt(0) },
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            include: {
              trafficPackProduct: { include: { catalogProduct: true } },
            },
          },
          onlinePresence: {
            where: {
              observedAt: { gte: new Date(now.getTime() - 45_000) },
              concurrentClients: { gt: 0 },
            },
            select: { nodeId: true, concurrentClients: true },
          },
        },
      }),
      this.customerTraffic.daily(id, {}, now),
    ]);
    if (!user || user.deletedAt) {
      throw new NotFoundException('Customer not found');
    }
    const v2Quota = user.entitlementGrants.flatMap((grant) =>
      grant.quotaBuckets.map((bucket) => ({
        grantedBytes: bucket.grantedBytes,
        consumedBytes: bucket.consumedBytes,
        trafficMultiplierBasisPointsSnapshot:
          bucket.trafficMultiplierBasisPointsSnapshot ??
          grant.trafficMultiplierBasisPointsSnapshot ??
          10_000,
      })),
    );
    const legacySubscriptionQuota = user.subscriptions.map((subscription) => {
      const cycle = subscription.cycles[0];
      return {
        grantedBytes: cycle
          ? cycle.grantedBytes + cycle.adjustmentBytes
          : subscription.includedTrafficBytes + subscription.bonusTrafficBytes,
        consumedBytes:
          cycle?.consumedBytes ?? subscription.consumedTrafficBytes,
        trafficMultiplierBasisPointsSnapshot:
          user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000,
      };
    });
    const legacyPackQuota = user.trafficPacks.map((pack) => ({
      grantedBytes: pack.totalBytes,
      consumedBytes: pack.totalBytes - pack.remainingBytes,
      trafficMultiplierBasisPointsSnapshot:
        pack.trafficPackProduct?.catalogProduct
          ?.defaultTrafficMultiplierBasisPoints ??
        user.accessAccount?.trafficMultiplierBasisPoints ??
        10_000,
    }));
    const quota = [...v2Quota, ...legacySubscriptionQuota, ...legacyPackQuota];
    const grantedBytes = quota.reduce(
      (total, bucket) => total + Number(bucket.grantedBytes),
      0,
    );
    const consumedBytes = quota.reduce(
      (total, bucket) => total + Number(bucket.consumedBytes),
      0,
    );
    const remainingBytes = quota.reduce(
      (total, item) =>
        total + Math.max(Number(item.grantedBytes - item.consumedBytes), 0),
      0,
    );
    const entitlementMultiplierBasisPoints = Math.max(
      user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000,
      ...quota
        .filter((bucket) => bucket.grantedBytes > bucket.consumedBytes)
        .map((bucket) => bucket.trafficMultiplierBasisPointsSnapshot),
    );
    const userMultiplierBasisPoints =
      user.accessAccount?.trafficMultiplierOverrideBasisPoints ?? 10_000;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status.toLowerCase(),
      notes: user.notes,
      balanceCents: user.balanceCents,
      planTrafficMultiplier:
        (user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000) / 10_000,
      entitlementTrafficMultiplier: entitlementMultiplierBasisPoints / 10_000,
      trafficMultiplier: userMultiplierBasisPoints / 10_000,
      effectiveTrafficMultiplier:
        Math.max(entitlementMultiplierBasisPoints, userMultiplierBasisPoints) /
        10_000,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      summary: {
        activeGrantCount:
          user.entitlementGrants.length +
          user.subscriptions.length +
          user.trafficPacks.length,
        grantedBytes,
        consumedBytes,
        remainingBytes,
        online: user.onlinePresence.length > 0,
        onlineNodeCount: new Set(
          user.onlinePresence.map((presence) => presence.nodeId),
        ).size,
        onlineClients: user.onlinePresence.reduce(
          (total, presence) => total + presence.concurrentClients,
          0,
        ),
        recentTraffic: recentTraffic.items,
      },
    };
  }

  async getCustomerDailyTraffic(id: string, query: DailyTrafficQuery) {
    await this.requireCustomer(id);
    return this.customerTraffic.daily(id, query);
  }

  async getCustomerEntitlements(id: string, query: PageQuery) {
    await this.requireCustomer(id);
    const { page, pageSize, skip } = parsePage(query);
    const where: Prisma.EntitlementGrantWhereInput = { userId: id };
    const [grants, total] = await Promise.all([
      this.prisma.entitlementGrant.findMany({
        where,
        include: {
          product: true,
          offer: true,
          accessProfile: true,
          quotaBuckets: { orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.entitlementGrant.count({ where }),
    ]);
    const now = new Date();
    return pageResponse(
      grants.map((grant) => ({
        id: grant.id,
        kind: grant.kind.toLowerCase(),
        status:
          grant.status === 'ACTIVE' && grant.endsAt <= now
            ? 'expired'
            : grant.status.toLowerCase(),
        productId: grant.productId,
        productName: grant.product.name,
        offerId: grant.offerId,
        offerName: grant.offer?.name ?? null,
        startsAt: grant.startsAt.toISOString(),
        endsAt: grant.endsAt.toISOString(),
        accessProfileName: grant.accessProfile.name,
        speedUpMbps: grant.speedUpMbpsSnapshot,
        speedDownMbps: grant.speedDownMbpsSnapshot,
        deviceLimit: grant.deviceLimitSnapshot,
        buckets: grant.quotaBuckets.map((bucket) => ({
          id: bucket.id,
          kind: bucket.kind.toLowerCase(),
          startsAt: bucket.startsAt.toISOString(),
          endsAt: bucket.endsAt.toISOString(),
          grantedBytes: Number(bucket.grantedBytes),
          consumedBytes: Number(bucket.consumedBytes),
          remainingBytes: this.remaining(
            bucket.grantedBytes,
            bucket.consumedBytes,
          ),
        })),
      })),
      total,
      page,
      pageSize,
    );
  }

  async getCustomerAccess(id: string, query: PageQuery) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { accessTokens: { orderBy: { createdAt: 'desc' } } },
    });
    if (!user || user.role !== UserRole.MEMBER || user.deletedAt) {
      throw new NotFoundException('Customer not found');
    }
    const { page, pageSize, skip } = parsePage(query);
    const freshSince = new Date(Date.now() - 45_000);
    const where: Prisma.OnlinePresenceWhereInput = {
      userId: id,
      observedAt: { gte: freshSince },
      concurrentClients: { gt: 0 },
    };
    const [presence, total] = await Promise.all([
      this.prisma.onlinePresence.findMany({
        where,
        include: { node: { include: { server: true } } },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.onlinePresence.count({ where }),
    ]);
    return {
      identities: user.accessTokens.map((token) => ({
        id: token.id,
        label: token.label,
        tokenPreview: this.previewToken(token.token),
        subscriptionUrl: this.subscriptionUrl(token.token),
        mihomoSubscriptionUrl: this.mihomoSubscriptionUrl(token.token),
        vlessUuid: token.vlessUuid,
        revokedAt: token.revokedAt?.toISOString() ?? null,
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        createdAt: token.createdAt.toISOString(),
      })),
      presence: pageResponse(
        presence.map((item) => ({
          id: item.id,
          nodeId: item.nodeId,
          nodeLabel: item.node.label,
          serverName: item.node.server?.name ?? item.node.hostname,
          protocol: item.node.protocol.toLowerCase(),
          concurrentClients: item.concurrentClients,
          observedAt: item.observedAt.toISOString(),
        })),
        total,
        page,
        pageSize,
      ),
    };
  }

  async rotateAccessToken(userId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, deletedAt: true },
      });
      if (!user || user.role !== UserRole.MEMBER || user.deletedAt) {
        throw new NotFoundException('Customer not found');
      }
      const revokedAt = new Date();
      const revoked = await tx.accessToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      });
      const created = await tx.accessToken.create({
        data: {
          userId,
          label: 'Primary access token',
          token: this.generateAccessToken(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'CUSTOMER_ACCESS_TOKEN_ROTATED',
          targetType: 'AccessToken',
          targetId: created.id,
          metadata: { userId, revokedCount: revoked.count },
        },
      });
      return this.presentAccessToken(created);
    });
  }

  async revokeAccessToken(userId: string, tokenId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireCustomerWith(tx, userId);
      const revokedAt = new Date();
      const result = await tx.accessToken.updateMany({
        where: { id: tokenId, userId, revokedAt: null },
        data: { revokedAt },
      });
      if (result.count !== 1) {
        throw new NotFoundException('Active access token not found');
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'CUSTOMER_ACCESS_TOKEN_REVOKED',
          targetType: 'AccessToken',
          targetId: tokenId,
          metadata: { userId },
        },
      });
      return { id: tokenId, revokedAt: revokedAt.toISOString() };
    });
  }

  async getCustomerTraffic(id: string, query: PageQuery) {
    await this.requireCustomer(id);
    const { page, pageSize, skip } = parsePage(query);
    const where = { userId: id };
    const [rollups, total] = await Promise.all([
      this.prisma.usageRollup.findMany({
        where,
        include: {
          node: true,
          allocations: { include: { quotaBucket: true } },
        },
        orderBy: [{ bucketStart: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.usageRollup.count({ where }),
    ]);
    return pageResponse(
      rollups.map((rollup) => ({
        id: rollup.id,
        nodeId: rollup.nodeId,
        nodeLabel: rollup.node.label,
        bucketStart: rollup.bucketStart.toISOString(),
        physicalBytes: Number(rollup.txBytes + rollup.rxBytes),
        accountedBytes: Number(
          rollup.accountedBytes ?? rollup.txBytes + rollup.rxBytes,
        ),
        allocations: rollup.allocations.map((allocation) => ({
          quotaBucketId: allocation.quotaBucketId,
          accountedBytes: Number(allocation.accountedBytes),
        })),
      })),
      total,
      page,
      pageSize,
    );
  }

  async getCustomerFinance(
    id: string,
    kind: 'orders' | 'wallet',
    query: PageQuery,
  ) {
    await this.requireCustomer(id);
    const { page, pageSize, skip } = parsePage(query);
    if (kind === 'wallet') {
      const where = { userId: id };
      const [entries, total] = await Promise.all([
        this.prisma.walletLedgerEntry.findMany({
          where,
          include: { actor: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take: pageSize,
        }),
        this.prisma.walletLedgerEntry.count({ where }),
      ]);
      return pageResponse(
        entries.map((entry) => ({
          id: entry.id,
          kind: entry.kind.toLowerCase(),
          amountCents: entry.amountCents,
          beforeBalanceCents: entry.beforeBalanceCents,
          afterBalanceCents: entry.afterBalanceCents,
          actorEmail: entry.actor?.email ?? null,
          note: entry.note,
          createdAt: entry.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
      );
    }
    const where = { userId: id };
    const [orders, total] = await Promise.all([
      this.prisma.manualOrder.findMany({
        where,
        include: {
          catalogOffer: { include: { product: true } },
          refunds: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.manualOrder.count({ where }),
    ]);
    return pageResponse(
      orders.map((order) => ({
        id: order.id,
        status: order.status.toLowerCase(),
        source: order.source.toLowerCase(),
        kind: order.kind.toLowerCase(),
        productName:
          order.productNameSnapshot ?? order.catalogOffer?.product.name ?? null,
        amountCents: order.amountCents,
        refundedCents: order.refunds
          .filter((refund) => refund.status === 'APPLIED')
          .reduce((total, refund) => total + refund.amountCents, 0),
        createdAt: order.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  async getCustomerTimeline(id: string, query: PageQuery) {
    await this.requireCustomer(id);
    const { page, pageSize, skip } = parsePage(query);
    const where = { targetId: id };
    const [events, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return pageResponse(
      events.map((event) => ({
        id: event.id,
        action: event.action,
        targetType: event.targetType,
        actorEmail: event.actor?.email ?? null,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  async setCustomerStatus(id: string, status: string, actorId: string) {
    const normalized = this.userStatus(status);
    if (!normalized || normalized === undefined) {
      throw new BadRequestException('Invalid customer status');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user || user.role !== UserRole.MEMBER || user.deletedAt) {
        throw new NotFoundException('Customer not found');
      }
      const result = await tx.user.update({
        where: { id },
        data: { status: normalized, sessionVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'CUSTOMER_STATUS_CHANGED',
          targetType: 'User',
          targetId: id,
          metadata: { before: user.status, after: normalized },
        },
      });
      return result;
    });
    return { id: updated.id, status: updated.status.toLowerCase() };
  }

  async deleteCustomer(id: string, confirmationEmail: string, actorId: string) {
    const replacementPasswordHash = await hash(
      randomBytes(32).toString('base64url'),
      10,
    );
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id },
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            balanceCents: true,
            deletedAt: true,
          },
        });
        if (!user || user.role !== UserRole.MEMBER || user.deletedAt) {
          throw new NotFoundException('Customer not found');
        }
        if (
          confirmationEmail.trim().toLowerCase() !==
          user.email.trim().toLowerCase()
        ) {
          throw new BadRequestException('Confirmation email does not match');
        }

        const deletedAt = new Date();
        const groupCleanup = await closeGroupBuyParticipationForAccountDeletion(
          tx,
          id,
          deletedAt,
        );

        if (user.balanceCents > 0) {
          await postWalletEntry(tx, {
            userId: id,
            actorId,
            amountCents: -user.balanceCents,
            kind: 'ADJUST',
            idempotencyKey: `account-deletion:${id}`,
            note: '账户删除余额核销',
          });
        }
        const revokedEntitlements =
          await this.entitlements.revokeUserEntitlements(tx, {
            userId: id,
            at: deletedAt,
            actorId,
            reason: '账户删除',
          });
        const [tokens, paymentAttempts] = await Promise.all([
          tx.accessToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: deletedAt },
          }),
          tx.epayPaymentAttempt.updateMany({
            where: { userId: id, status: EpayPaymentStatus.PENDING },
            data: {
              status: EpayPaymentStatus.EXPIRED,
              activeKey: null,
              closedAt: deletedAt,
            },
          }),
        ]);

        await tx.onlinePresence.deleteMany({ where: { userId: id } });
        await tx.passwordResetToken.updateMany({
          where: { userId: id, usedAt: null },
          data: { usedAt: deletedAt },
        });
        await tx.referralCode.updateMany({
          where: { ownerId: id, active: true },
          data: { active: false },
        });
        await tx.referralAttribution.updateMany({
          where: {
            status: 'PENDING',
            OR: [{ inviterId: id }, { inviteeId: id }],
          },
          data: { status: 'REVERSED', reversedAt: deletedAt },
        });

        const replacementEmail = `deleted+${id}@accounts.invalid`;
        await tx.user.update({
          where: { id },
          data: {
            email: replacementEmail,
            displayName: '已删除用户',
            passwordHash: replacementPasswordHash,
            status: UserStatus.BANNED,
            notes: null,
            deletedAt,
            sessionVersion: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'CUSTOMER_ACCOUNT_DELETED',
            targetType: 'User',
            targetId: id,
            metadata: {
              revokedAccessTokens: tokens.count,
              canceledEntitlements: revokedEntitlements.grants,
              canceledSubscriptions: revokedEntitlements.subscriptions,
              expiredTrafficPacks: revokedEntitlements.trafficPacks,
              expiredPaymentAttempts: paymentAttempts.count,
              closedGroupMemberships: groupCleanup.closedMemberships,
              queuedLegacyGroupRefunds: groupCleanup.queuedLegacyRefunds,
              forfeitedBalanceCents: user.balanceCents,
            },
          },
        });

        return {
          success: true,
          id,
          deletedAt: deletedAt.toISOString(),
          emailReleased: true,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async adjustBalance(
    id: string,
    deltaCents: number,
    note: string | undefined,
    actorId: string,
    idempotencyKey: string,
  ) {
    if (!Number.isSafeInteger(deltaCents) || deltaCents === 0) {
      throw new BadRequestException('deltaCents must be a non-zero integer');
    }
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 120) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    const auditNote = note?.trim() || '管理员即时调整';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const posting = await postWalletEntry(tx, {
              userId: id,
              actorId,
              amountCents: deltaCents,
              kind: 'ADJUST',
              idempotencyKey: normalizedKey,
              note: auditNote,
            });
            if (posting.replayed) {
              return { id: posting.ledgerId, ...posting };
            }
            await tx.auditLog.create({
              data: {
                actorId,
                action: 'CUSTOMER_BALANCE_ADJUSTED',
                targetType: 'User',
                targetId: id,
                metadata: {
                  deltaCents,
                  before: posting.beforeBalanceCents,
                  after: posting.afterBalanceCents,
                  note: auditNote,
                },
              },
            });
            return { id: posting.ledgerId, ...posting };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable) throw error;
        const replay = await this.prisma.walletLedgerEntry.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: id,
              idempotencyKey: normalizedKey,
            },
          },
        });
        if (replay) return replay;
        if (attempt === 2) {
          throw new ConflictException('余额调整发生并发冲突，请重试');
        }
      }
    }
    throw new ConflictException('余额调整发生并发冲突，请重试');
  }

  async adjustQuotaBucket(
    bucketId: string,
    remainingBytes: number,
    reason: string | undefined,
    actorId: string,
  ) {
    return this.entitlements.adjustQuotaBucketRemaining(
      bucketId,
      remainingBytes,
      reason,
      actorId,
    );
  }

  async setTrafficMultiplier(
    userId: string,
    multiplier: number,
    actorId: string,
  ) {
    return this.entitlements
      .updateTrafficMultiplier(userId, multiplier, actorId)
      .then((result) => ({
        userId,
        trafficMultiplier: result.userTrafficMultiplier,
        effectiveTrafficMultiplier: result.trafficMultiplier,
      }));
  }

  async adjustAvailableQuota(
    userId: string,
    input: CustomerQuotaOperationDto,
    actorId: string,
  ) {
    return this.entitlements.adjustAvailableQuota(userId, input, actorId);
  }

  private async userIdsForQuotaState(state: string, now: Date) {
    const predicate = this.quotaPredicate(state);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH quota_parts AS (
        SELECT grant_record."userId" AS "userId",
          GREATEST(bucket."grantedBytes" - bucket."consumedBytes", 0)::bigint AS remaining
        FROM "EntitlementGrant" grant_record
        JOIN "QuotaBucket" bucket ON bucket."grantId" = grant_record."id"
        WHERE grant_record."status" = 'ACTIVE'
          AND grant_record."startsAt" <= ${now}
          AND grant_record."endsAt" > ${now}
          AND bucket."startsAt" <= ${now}
          AND bucket."endsAt" > ${now}
        UNION ALL
        SELECT subscription."userId" AS "userId",
          CASE
            WHEN cycle."id" IS NULL THEN GREATEST(
              subscription."includedTrafficBytes" + subscription."bonusTrafficBytes" - subscription."consumedTrafficBytes",
              0
            )
            ELSE GREATEST(
              cycle."grantedBytes" + cycle."adjustmentBytes" - cycle."consumedBytes",
              0
            )
          END::bigint AS remaining
        FROM "Subscription" subscription
        LEFT JOIN "SubscriptionCycle" cycle
          ON cycle."subscriptionId" = subscription."id"
          AND cycle."startsAt" <= ${now}
          AND cycle."endsAt" > ${now}
        LEFT JOIN "EntitlementGrant" linked_subscription
          ON linked_subscription."legacySubscriptionId" = subscription."id"
        WHERE subscription."status" = 'ACTIVE'
          AND subscription."startsAt" <= ${now}
          AND subscription."endsAt" > ${now}
          AND linked_subscription."legacySubscriptionId" IS NULL
        UNION ALL
        SELECT pack."userId" AS "userId",
          GREATEST(pack."remainingBytes", 0)::bigint AS remaining
        FROM "TrafficPack" pack
        LEFT JOIN "EntitlementGrant" linked_pack
          ON linked_pack."legacyTrafficPackId" = pack."id"
        WHERE pack."status" = 'ACTIVE'
          AND pack."remainingBytes" > 0
          AND (pack."expiresAt" IS NULL OR pack."expiresAt" > ${now})
          AND linked_pack."legacyTrafficPackId" IS NULL
      ), quota AS (
        SELECT "userId", COALESCE(SUM(remaining), 0)::bigint AS remaining
        FROM quota_parts
        GROUP BY "userId"
      )
      SELECT member."id"
      FROM "User" member
      LEFT JOIN quota ON quota."userId" = member."id"
      WHERE ${predicate}
    `);
    return rows.map((row) => row.id);
  }

  private async requireCustomer(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!user || user.role !== UserRole.MEMBER || user.deletedAt) {
      throw new NotFoundException('Customer not found');
    }
    return user;
  }

  private async requireCustomerWith(tx: Prisma.TransactionClient, id: string) {
    const user = await tx.user.findUnique({
      where: { id },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!user || user.role !== UserRole.MEMBER || user.deletedAt) {
      throw new NotFoundException('Customer not found');
    }
    return user;
  }

  private async subscriptionIdsForQuotaState(state: string) {
    const predicate = this.quotaPredicate(state);
    const now = new Date();
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH quota AS (
        SELECT grant_record."legacySubscriptionId" AS "subscriptionId",
          COALESCE(SUM(GREATEST(bucket."grantedBytes" - bucket."consumedBytes", 0)), 0)::bigint AS remaining
        FROM "EntitlementGrant" grant_record
        JOIN "QuotaBucket" bucket ON bucket."grantId" = grant_record."id"
        WHERE grant_record."legacySubscriptionId" IS NOT NULL
          AND bucket."startsAt" <= ${now}
          AND bucket."endsAt" > ${now}
        GROUP BY grant_record."legacySubscriptionId"
      )
      SELECT subscription."id"
      FROM "Subscription" subscription
      LEFT JOIN quota ON quota."subscriptionId" = subscription."id"
      WHERE ${predicate}
    `);
    return rows.map((row) => row.id);
  }

  private quotaPredicate(state: string) {
    const remaining = Prisma.sql`COALESCE(quota.remaining, 0)`;
    const lowThreshold = BigInt(10 * 1024 * 1024 * 1024);
    if (state === 'available') {
      return Prisma.sql`${remaining} > ${lowThreshold}`;
    }
    if (state === 'low') {
      return Prisma.sql`${remaining} > 0 AND ${remaining} <= ${lowThreshold}`;
    }
    if (state === 'exhausted') {
      return Prisma.sql`${remaining} <= 0`;
    }
    throw new BadRequestException('Invalid quota state');
  }

  private remaining(granted: bigint, consumed: bigint) {
    return Number(granted > consumed ? granted - consumed : BigInt(0));
  }

  private quotaState(remainingBytes: number) {
    if (remainingBytes <= 0) return 'exhausted';
    if (remainingBytes <= 10 * 1024 * 1024 * 1024) return 'low';
    return 'available';
  }

  private previewToken(token: string) {
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
  }

  private subscriptionUrl(token: string) {
    return `${apiPublicUrl()}/subscribe/${encodeURIComponent(token)}`;
  }

  private mihomoSubscriptionUrl(token: string) {
    return `${this.subscriptionUrl(token)}/clash`;
  }

  private generateAccessToken() {
    return `hy2_${randomBytes(12).toString('hex')}`;
  }

  private presentAccessToken(token: {
    id: string;
    label: string;
    token: string;
    vlessUuid: string;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: token.id,
      label: token.label,
      tokenPreview: this.previewToken(token.token),
      subscriptionUrl: this.subscriptionUrl(token.token),
      mihomoSubscriptionUrl: this.mihomoSubscriptionUrl(token.token),
      vlessUuid: token.vlessUuid,
      revokedAt: token.revokedAt?.toISOString() ?? null,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
    };
  }

  private validDate(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private userStatus(status: string) {
    const value = status.toUpperCase();
    return value in UserStatus ? (value as UserStatus) : undefined;
  }

  private userRole(role: string) {
    const value = role.toUpperCase();
    return value in UserRole ? (value as UserRole) : undefined;
  }

  private subscriptionStatus(status: string) {
    const value = status.toUpperCase();
    return value in SubscriptionStatus
      ? (value as SubscriptionStatus)
      : undefined;
  }
}
