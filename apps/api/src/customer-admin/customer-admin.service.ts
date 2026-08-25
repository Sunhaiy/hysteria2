import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  Prisma,
  QuotaAdjustmentMode,
  SubscriptionStatus,
  TrafficPackStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CustomerQuotaOperationDto } from './customer-admin.dto';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';

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
  constructor(private readonly prisma: PrismaService) {}

  async searchOptions(query: Pick<CustomerQuery, 'q' | 'pageSize'>) {
    const q = query.q?.trim();
    const pageSize = Math.min(parsePage(query).pageSize, 20);
    return this.prisma.user.findMany({
      where: {
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
    const where: Prisma.UserWhereInput = {};
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
            where: { status: SubscriptionStatus.ACTIVE, endsAt: { gt: now } },
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
              status: TrafficPackStatus.ACTIVE,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
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
        if (!cycle) return total;
        return (
          total +
          this.remaining(
            cycle.grantedBytes + cycle.adjustmentBytes,
            cycle.consumedBytes,
          )
        );
      }, 0);
      const packRemaining = user.trafficPacks.reduce(
        (total, pack) => total + Number(pack.remainingBytes),
        0,
      );
      const remainingBytes = planRemaining + packRemaining;
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
            user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000,
            user.accessAccount?.trafficMultiplierOverrideBasisPoints ?? 10_000,
          ) / 10_000,
        remainingBytes,
        activePlanNames: user.subscriptions.map((item) => item.plan.name),
        activeTrafficPackCount: user.trafficPacks.length,
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
    const [user, orders] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id },
        include: {
          accessAccount: true,
          entitlementGrants: {
            where: { status: 'ACTIVE', endsAt: { gt: now } },
            include: {
              quotaBuckets: {
                where: { startsAt: { lte: now }, endsAt: { gt: now } },
                select: { grantedBytes: true, consumedBytes: true },
              },
            },
          },
          onlinePresence: {
            where: {
              observedAt: { gte: new Date(now.getTime() - 45_000) },
              concurrentClients: { gt: 0 },
            },
            select: { concurrentClients: true },
          },
        },
      }),
      this.prisma.manualOrder.aggregate({
        where: { userId: id, status: 'APPLIED' },
        _sum: { amountCents: true },
      }),
    ]);
    if (!user) throw new NotFoundException('Customer not found');
    const remainingBytes = user.entitlementGrants.reduce(
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
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status.toLowerCase(),
      notes: user.notes,
      balanceCents: user.balanceCents,
      planTrafficMultiplier:
        (user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000) / 10_000,
      trafficMultiplier:
        (user.accessAccount?.trafficMultiplierOverrideBasisPoints ?? 10_000) /
        10_000,
      effectiveTrafficMultiplier:
        Math.max(
          user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000,
          user.accessAccount?.trafficMultiplierOverrideBasisPoints ?? 10_000,
        ) / 10_000,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      summary: {
        activeGrantCount: user.entitlementGrants.length,
        remainingBytes,
        onlineClients: user.onlinePresence.reduce(
          (total, presence) => total + presence.concurrentClients,
          0,
        ),
        lifetimeOrderCents: orders._sum.amountCents ?? 0,
      },
    };
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
    if (!user || user.role !== UserRole.MEMBER) {
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
        select: { id: true, role: true },
      });
      if (!user || user.role !== UserRole.MEMBER) {
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
      if (!user || user.role !== UserRole.MEMBER) {
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
    const auditNote = note?.trim() || '管理员即时调整';
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.walletLedgerEntry.findUnique({
        where: { userId_idempotencyKey: { userId: id, idempotencyKey } },
      });
      if (replay) return replay;
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException('Customer not found');
      const after = user.balanceCents + deltaCents;
      if (after < 0)
        throw new BadRequestException('Balance cannot be negative');
      await tx.user.update({ where: { id }, data: { balanceCents: after } });
      const legacy = await tx.walletTransaction.create({
        data: {
          userId: id,
          amountCents: deltaCents,
          kind: 'ADJUST',
          note: auditNote,
        },
      });
      const ledger = await tx.walletLedgerEntry.create({
        data: {
          legacyTransactionId: legacy.id,
          userId: id,
          actorId,
          amountCents: deltaCents,
          beforeBalanceCents: user.balanceCents,
          afterBalanceCents: after,
          kind: 'ADJUST',
          idempotencyKey,
          note: auditNote,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'CUSTOMER_BALANCE_ADJUSTED',
          targetType: 'User',
          targetId: id,
          metadata: {
            deltaCents,
            before: user.balanceCents,
            after,
            note: auditNote,
          },
        },
      });
      return ledger;
    });
  }

  async adjustQuotaBucket(
    bucketId: string,
    remainingBytes: number,
    reason: string | undefined,
    actorId: string,
  ) {
    if (!Number.isSafeInteger(remainingBytes) || remainingBytes < 0) {
      throw new BadRequestException(
        'remainingBytes must be a non-negative integer',
      );
    }
    const auditReason = reason?.trim() || '管理员即时调整';
    return this.prisma.$transaction(async (tx) => {
      const bucket = await tx.quotaBucket.findUnique({
        where: { id: bucketId },
        include: { grant: true },
      });
      if (!bucket) throw new NotFoundException('Quota bucket not found');
      const remaining = BigInt(remainingBytes);
      const grantedBytes = remaining + bucket.consumedBytes;
      const updated = await tx.quotaBucket.update({
        where: { id: bucketId },
        data: { grantedBytes },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'QUOTA_BUCKET_ADJUSTED',
          targetType: 'QuotaBucket',
          targetId: bucketId,
          metadata: {
            userId: bucket.grant.userId,
            beforeRemainingBytes: Number(
              bucket.grantedBytes - bucket.consumedBytes,
            ),
            afterRemainingBytes: remainingBytes,
            reason: auditReason,
          },
        },
      });
      return {
        id: updated.id,
        grantedBytes: Number(updated.grantedBytes),
        consumedBytes: Number(updated.consumedBytes),
        remainingBytes,
      };
    });
  }

  async setTrafficMultiplier(
    userId: string,
    multiplier: number,
    actorId: string,
  ) {
    const basisPoints = Math.round(multiplier * 10_000);
    if (
      !Number.isFinite(multiplier) ||
      basisPoints < 1_000 ||
      basisPoints > 1_000_000
    ) {
      throw new BadRequestException('Traffic multiplier must be 0.1 to 100');
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.role !== UserRole.MEMBER) {
        throw new NotFoundException('Customer not found');
      }
      const before = await tx.accessAccount.findUnique({ where: { userId } });
      const account = await tx.accessAccount.upsert({
        where: { userId },
        create: {
          userId,
          trafficMultiplierOverrideBasisPoints: basisPoints,
        },
        update: {
          trafficMultiplierOverrideBasisPoints: basisPoints,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'CUSTOMER_TRAFFIC_MULTIPLIER_CHANGED',
          targetType: 'AccessAccount',
          targetId: account.id,
          metadata: {
            userId,
            before:
              (before?.trafficMultiplierOverrideBasisPoints ?? 10_000) / 10_000,
            after: basisPoints / 10_000,
          },
        },
      });
      return {
        userId,
        trafficMultiplier: basisPoints / 10_000,
        effectiveTrafficMultiplier:
          Math.max(account.trafficMultiplierBasisPoints, basisPoints) / 10_000,
      };
    });
  }

  async adjustAvailableQuota(
    userId: string,
    input: CustomerQuotaOperationDto,
    actorId: string,
  ) {
    const auditReason = input.reason?.trim() || '管理员即时调整';
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.accessAccount.findUnique({ where: { userId } });
      if (!account)
        throw new NotFoundException('Customer access account not found');
      const now = new Date();
      const buckets = await tx.quotaBucket.findMany({
        where: {
          grant: {
            userId,
            status: 'ACTIVE',
            endsAt: { gt: now },
            ...(input.grantId ? { id: input.grantId } : {}),
          },
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        include: { grant: { select: { id: true, productId: true } } },
        orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
      });
      if (!buckets.length) {
        throw new BadRequestException('Customer has no active quota bucket');
      }
      const totalBefore = buckets.reduce(
        (sum, bucket) =>
          sum +
          (bucket.grantedBytes > bucket.consumedBytes
            ? bucket.grantedBytes - bucket.consumedBytes
            : BigInt(0)),
        BigInt(0),
      );
      let delta: bigint;
      if (input.mode === 'delta') {
        if (input.bytes === undefined || !Number.isSafeInteger(input.bytes)) {
          throw new BadRequestException(
            'bytes is required for delta adjustment',
          );
        }
        delta = BigInt(input.bytes);
      } else {
        if (
          input.remainingBytes === undefined ||
          !Number.isSafeInteger(input.remainingBytes) ||
          input.remainingBytes < 0
        ) {
          throw new BadRequestException(
            'remainingBytes is required for set_remaining adjustment',
          );
        }
        delta = BigInt(input.remainingBytes) - totalBefore;
      }
      if (totalBefore + delta < BigInt(0)) {
        throw new BadRequestException('Adjustment would make quota negative');
      }

      const adjustments: Array<{
        bucketId: string;
        beforeRemainingBytes: number;
        afterRemainingBytes: number;
      }> = [];
      if (delta >= BigInt(0)) {
        const bucket = buckets[0];
        const before = bucket.grantedBytes - bucket.consumedBytes;
        const after = before + delta;
        await tx.quotaBucket.update({
          where: { id: bucket.id },
          data: { grantedBytes: bucket.consumedBytes + after },
        });
        await tx.quotaAdjustment.create({
          data: {
            accessAccountId: account.id,
            quotaBucketId: bucket.id,
            actorId,
            mode:
              input.mode === 'delta'
                ? QuotaAdjustmentMode.DELTA
                : QuotaAdjustmentMode.SET_REMAINING,
            deltaBytes: delta,
            beforeRemainingBytes: before,
            afterRemainingBytes: after,
            reason: auditReason,
          },
        });
        adjustments.push({
          bucketId: bucket.id,
          beforeRemainingBytes: Number(before),
          afterRemainingBytes: Number(after),
        });
      } else {
        let remainingReduction = -delta;
        for (const bucket of buckets) {
          if (remainingReduction === BigInt(0)) break;
          const before =
            bucket.grantedBytes > bucket.consumedBytes
              ? bucket.grantedBytes - bucket.consumedBytes
              : BigInt(0);
          const reduction =
            before < remainingReduction ? before : remainingReduction;
          if (reduction === BigInt(0)) continue;
          const after = before - reduction;
          await tx.quotaBucket.update({
            where: { id: bucket.id },
            data: { grantedBytes: bucket.consumedBytes + after },
          });
          await tx.quotaAdjustment.create({
            data: {
              accessAccountId: account.id,
              quotaBucketId: bucket.id,
              actorId,
              mode:
                input.mode === 'delta'
                  ? QuotaAdjustmentMode.DELTA
                  : QuotaAdjustmentMode.SET_REMAINING,
              deltaBytes: -reduction,
              beforeRemainingBytes: before,
              afterRemainingBytes: after,
              reason: auditReason,
            },
          });
          adjustments.push({
            bucketId: bucket.id,
            beforeRemainingBytes: Number(before),
            afterRemainingBytes: Number(after),
          });
          remainingReduction -= reduction;
        }
      }

      const totalAfter = totalBefore + delta;
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'CUSTOMER_AVAILABLE_QUOTA_ADJUSTED',
          targetType: 'AccessAccount',
          targetId: account.id,
          metadata: {
            userId,
            grantId: input.grantId ?? null,
            beforeRemainingBytes: Number(totalBefore),
            afterRemainingBytes: Number(totalAfter),
            reason: auditReason,
          },
        },
      });
      return {
        userId,
        grantId: input.grantId ?? null,
        beforeRemainingBytes: Number(totalBefore),
        remainingBytes: Number(totalAfter),
        adjustments,
      };
    });
  }

  private async userIdsForQuotaState(state: string, now: Date) {
    const predicate = this.quotaPredicate(state);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH quota AS (
        SELECT grant_record."userId" AS "userId",
          COALESCE(SUM(GREATEST(bucket."grantedBytes" - bucket."consumedBytes", 0)), 0)::bigint AS remaining
        FROM "EntitlementGrant" grant_record
        JOIN "QuotaBucket" bucket ON bucket."grantId" = grant_record."id"
        WHERE grant_record."status" = 'ACTIVE'
          AND grant_record."endsAt" > ${now}
          AND bucket."startsAt" <= ${now}
          AND bucket."endsAt" > ${now}
        GROUP BY grant_record."userId"
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
      select: { id: true, role: true },
    });
    if (!user || user.role !== UserRole.MEMBER) {
      throw new NotFoundException('Customer not found');
    }
    return user;
  }

  private async requireCustomerWith(tx: Prisma.TransactionClient, id: string) {
    const user = await tx.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!user || user.role !== UserRole.MEMBER) {
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
    const publicBaseUrl = (
      process.env.API_PUBLIC_URL ?? 'http://localhost:4000'
    ).replace(/\/$/, '');
    return `${publicBaseUrl}/subscribe/${encodeURIComponent(token)}`;
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
