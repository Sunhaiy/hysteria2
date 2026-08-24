import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SubscriptionStatus,
  TrafficPackStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CustomerQuery {
  q?: string;
  status?: string;
  role?: string;
  planId?: string;
  entitlementKind?: string;
  quotaState?: string;
  createdFrom?: string;
  createdTo?: string;
  cursor?: string;
  limit?: string;
  sort?: string;
}

export interface SubscriptionQuery {
  q?: string;
  status?: string;
  planId?: string;
  nodeId?: string;
  billingPeriod?: string;
  quotaState?: string;
  expiresFrom?: string;
  expiresTo?: string;
  cursor?: string;
  limit?: string;
  sort?: string;
}

@Injectable()
export class CustomerAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: CustomerQuery) {
    const now = new Date();
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
      where.subscriptions = { some: { planId: query.planId } };
    }
    if (query.entitlementKind === 'plan') {
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
    const createdAt: Prisma.DateTimeFilter = {};
    const createdFrom = this.validDate(query.createdFrom);
    const createdTo = this.validDate(query.createdTo);
    if (createdFrom) createdAt.gte = createdFrom;
    if (createdTo) createdAt.lte = createdTo;
    if (createdFrom || createdTo) where.createdAt = createdAt;

    const rows = await this.prisma.user.findMany({
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
      },
      orderBy:
        query.sort === 'created_asc'
          ? { createdAt: 'asc' }
          : query.sort === 'email_asc'
            ? { email: 'asc' }
            : { createdAt: 'desc' },
    });
    const presented = rows
      .map((user) => {
        const planRemaining = user.subscriptions.reduce(
          (total, subscription) => {
            const cycle = subscription.cycles[0];
            if (!cycle) return total;
            return (
              total +
              this.remaining(
                cycle.grantedBytes + cycle.adjustmentBytes,
                cycle.consumedBytes,
              )
            );
          },
          0,
        );
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
            (user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000) /
            10_000,
          remainingBytes,
          activePlanNames: user.subscriptions.map((item) => item.plan.name),
          activeTrafficPackCount: user.trafficPacks.length,
          quotaState: this.quotaState(remainingBytes),
        };
      })
      .filter(
        (user) => !query.quotaState || user.quotaState === query.quotaState,
      );
    return this.page(presented, query.cursor, query.limit);
  }

  async listSubscriptions(query: SubscriptionQuery) {
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

    const rows = await this.prisma.subscription.findMany({
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
          ? { endsAt: 'asc' }
          : query.sort === 'created_asc'
            ? { createdAt: 'asc' }
            : { createdAt: 'desc' },
    });
    const presented = rows
      .map((subscription) => {
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
            (subscription.accessAccount?.trafficMultiplierBasisPoints ??
              10_000) / 10_000,
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
      })
      .filter(
        (subscription) =>
          !query.quotaState || subscription.quotaState === query.quotaState,
      );
    return this.page(presented, query.cursor, query.limit);
  }

  async getCustomer(id: string) {
    const now = new Date();
    const [user, audit] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id },
        include: {
          accessAccount: true,
          accessTokens: { orderBy: { createdAt: 'desc' } },
          entitlementGrants: {
            include: {
              product: true,
              offer: true,
              accessProfile: true,
              quotaBuckets: { orderBy: { endsAt: 'asc' } },
            },
            orderBy: { createdAt: 'desc' },
          },
          usageRollups: {
            include: {
              node: true,
              allocations: { include: { quotaBucket: true } },
            },
            orderBy: { bucketStart: 'desc' },
            take: 100,
          },
          onlineSnapshots: {
            include: { node: true },
            orderBy: { capturedAt: 'desc' },
            take: 30,
          },
          manualOrders: {
            include: {
              catalogOffer: { include: { product: true } },
              paymentRecords: true,
              refunds: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          },
          walletLedger: {
            include: { actor: true },
            orderBy: { createdAt: 'desc' },
            take: 100,
          },
          authEvents: {
            include: { node: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { targetId: id },
        include: { actor: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    if (!user) throw new NotFoundException('Customer not found');
    const grants = user.entitlementGrants.map((grant) => ({
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
        remainingBytes: Number(
          bucket.grantedBytes > bucket.consumedBytes
            ? bucket.grantedBytes - bucket.consumedBytes
            : BigInt(0),
        ),
      })),
    }));
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status.toLowerCase(),
      notes: user.notes,
      balanceCents: user.balanceCents,
      trafficMultiplier:
        (user.accessAccount?.trafficMultiplierBasisPoints ?? 10_000) / 10_000,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      summary: {
        activeGrantCount: grants.filter((grant) => grant.status === 'active')
          .length,
        remainingBytes: grants.reduce(
          (total, grant) =>
            total +
            grant.buckets.reduce(
              (bucketTotal, bucket) => bucketTotal + bucket.remainingBytes,
              0,
            ),
          0,
        ),
        onlineClients: user.onlineSnapshots
          .filter(
            (snapshot) =>
              now.getTime() - snapshot.capturedAt.getTime() <= 3 * 60 * 1000,
          )
          .reduce((total, snapshot) => total + snapshot.concurrentClients, 0),
        lifetimeOrderCents: user.manualOrders
          .filter((order) => order.status === 'APPLIED')
          .reduce((total, order) => total + order.amountCents, 0),
      },
      grants,
      accessIdentities: user.accessTokens.map((token) => ({
        id: token.id,
        label: token.label,
        tokenPreview: this.previewToken(token.token),
        vlessUuid: token.vlessUuid,
        revokedAt: token.revokedAt?.toISOString() ?? null,
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        createdAt: token.createdAt.toISOString(),
      })),
      usage: user.usageRollups.map((rollup) => ({
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
      sessions: user.onlineSnapshots.map((snapshot) => ({
        nodeId: snapshot.nodeId,
        nodeLabel: snapshot.node.label,
        concurrentClients: snapshot.concurrentClients,
        capturedAt: snapshot.capturedAt.toISOString(),
      })),
      orders: user.manualOrders.map((order) => ({
        id: order.id,
        status: order.status.toLowerCase(),
        source: order.source.toLowerCase(),
        kind: order.kind.toLowerCase(),
        productName:
          order.productNameSnapshot ?? order.catalogOffer?.product.name ?? null,
        amountCents: order.amountCents,
        paymentStatus: order.paymentRecords[0]?.status.toLowerCase() ?? null,
        refundedCents: order.refunds
          .filter((refund) => refund.status === 'APPLIED')
          .reduce((total, refund) => total + refund.amountCents, 0),
        createdAt: order.createdAt.toISOString(),
      })),
      wallet: user.walletLedger.map((entry) => ({
        id: entry.id,
        kind: entry.kind.toLowerCase(),
        amountCents: entry.amountCents,
        beforeBalanceCents: entry.beforeBalanceCents,
        afterBalanceCents: entry.afterBalanceCents,
        actorEmail: entry.actor?.email ?? null,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
      authEvents: user.authEvents.map((event) => ({
        id: event.id,
        granted: event.granted,
        reason: event.reason,
        nodeLabel: event.node?.label ?? null,
        remoteAddr: event.remoteAddr,
        createdAt: event.createdAt.toISOString(),
      })),
      timeline: audit.map((event) => ({
        id: event.id,
        action: event.action,
        targetType: event.targetType,
        actorEmail: event.actor?.email ?? null,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString(),
      })),
    };
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
    note: string,
    actorId: string,
    idempotencyKey: string,
  ) {
    if (!Number.isSafeInteger(deltaCents) || deltaCents === 0) {
      throw new BadRequestException('deltaCents must be a non-zero integer');
    }
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
          note,
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
          note,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'CUSTOMER_BALANCE_ADJUSTED',
          targetType: 'User',
          targetId: id,
          metadata: { deltaCents, before: user.balanceCents, after, note },
        },
      });
      return ledger;
    });
  }

  async adjustQuotaBucket(
    bucketId: string,
    remainingBytes: number,
    reason: string,
    actorId: string,
  ) {
    if (!Number.isSafeInteger(remainingBytes) || remainingBytes < 0) {
      throw new BadRequestException(
        'remainingBytes must be a positive integer',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const bucket = await tx.quotaBucket.findUnique({
        where: { id: bucketId },
        include: { grant: true },
      });
      if (!bucket) throw new NotFoundException('Quota bucket not found');
      const remaining = BigInt(remainingBytes);
      const grantedBytes =
        remaining + bucket.consumedBytes > bucket.grantedBytes
          ? remaining + bucket.consumedBytes
          : bucket.grantedBytes;
      const consumedBytes = grantedBytes - remaining;
      const updated = await tx.quotaBucket.update({
        where: { id: bucketId },
        data: { grantedBytes, consumedBytes },
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
            reason,
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

  private page<T extends { id: string }>(
    items: T[],
    cursor?: string,
    rawLimit?: string,
  ) {
    const parsed = Number.parseInt(rawLimit ?? '50', 10);
    const limit = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 200)
      : 50;
    const cursorIndex = cursor
      ? items.findIndex((item) => item.id === cursor)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageItems = items.slice(start, start + limit);
    const hasMore = start + pageItems.length < items.length;
    return {
      items: pageItems,
      nextCursor: hasMore ? (pageItems.at(-1)?.id ?? null) : null,
      total: items.length,
    };
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
