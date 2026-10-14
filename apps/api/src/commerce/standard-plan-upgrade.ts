import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { SecretCipherService } from '../security/secret-cipher.service';
import {
  catalogOfferSnapshotInclude,
  snapshotCatalogOffer,
  type CatalogOfferSnapshot,
} from './catalog-offer-snapshot';

export const UPGRADE_NOTE = 'STANDARD_PLAN_UPGRADE:';
export interface StandardUpgradeQuote {
  purpose: 'standard-plan-upgrade-v1';
  userId: string;
  grantId: string;
  state: string;
  quotedAt: string;
  expiresAt: string;
  startsAt: string;
  endsAt: string;
  sourceOrderId: string;
  sourceProductName: string;
  sourceProductId: string;
  sourceTrafficBytes: string;
  sourcePaidCents: number;
  creditBasis?: 'actual_payment' | 'admin_list_price' | 'previous_upgrade';
  creditBasisCents?: number;
  targetPriceCents: number;
  creditCents: number;
  targetRemainingCents: number;
  payableCents: number;
  target: CatalogOfferSnapshot;
}

/** Integer arithmetic, with the original actual calendar interval as denominator. */
export function remainingValue(
  cents: number,
  start: Date,
  end: Date,
  at: Date,
) {
  if (
    !Number.isSafeInteger(cents) ||
    cents < 0 ||
    end <= start ||
    at < start ||
    at >= end
  )
    throw new BadRequestException('套餐价格或购买周期无效');
  const duration = BigInt(end.getTime() - start.getTime());
  const remaining = BigInt(end.getTime() - at.getTime());
  return Number((BigInt(cents) * remaining + duration / 2n) / duration);
}

export const upgradeFingerprint = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    )
    .digest('hex');

export class StandardPlanUpgrade {
  constructor(private readonly cipher: SecretCipherService) {}

  decode(token: string): StandardUpgradeQuote {
    try {
      if (!this.cipher.enabled || !token.startsWith('enc:v1:'))
        throw new Error();
      const q = JSON.parse(this.cipher.decrypt(token)!) as StandardUpgradeQuote;
      if (q.purpose !== 'standard-plan-upgrade-v1') throw new Error();
      return q;
    } catch {
      throw new BadRequestException('升级报价无效，请重新获取');
    }
  }

  async read(tx: Prisma.TransactionClient, userId: string, now: Date) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE')
      throw new BadRequestException('账户不可购买');
    const grants = await tx.entitlementGrant.findMany({
      where: {
        userId,
        kind: 'PLAN',
        status: 'ACTIVE',
        endsAt: { gt: now },
        product: { series: 'STANDARD' },
      },
      include: {
        product: true,
        offer: true,
        quotaBuckets: {
          where: { startsAt: { lte: now }, endsAt: { gt: now } },
        },
        orders: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            refunds: true,
            epayPaymentAttempt: { include: { refundAttempt: true } },
          },
        },
      },
    });
    const g = grants[0];
    if (grants.length !== 1 || !g || g.startsAt > now)
      throw new ConflictException(
        '需有唯一当前普通套餐，且不能存在预约套餐；请先联系客服核对',
      );
    if (
      !g.offer ||
      !g.legacySubscriptionId ||
      !['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(g.offer.billingPeriod) ||
      g.quotaCadenceSnapshot !== 'MONTHLY_RESET' ||
      !g.trafficBytesSnapshot
    )
      throw new ConflictException('此套餐暂不支持自动补差价升级');
    if (g.quotaBuckets.length !== 1)
      throw new ConflictException('当前流量周期尚未就绪，请刷新后重试');
    const conflicting = await tx.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'PAUSED'] },
        endsAt: { gt: now },
        id: { not: g.legacySubscriptionId },
        plan: { catalogProduct: { series: 'STANDARD' } },
      },
      select: { id: true },
    });
    if (conflicting)
      throw new ConflictException('存在其他普通订阅或预约，请先联系客服核对');
    if (
      g.orders.some(
        (o) =>
          o.refunds.some((r) => r.status !== 'VOID') ||
          o.epayPaymentAttempt?.refundAttempt,
      )
    )
      throw new ConflictException('套餐存在退款记录，请先联系客服核对');
    const purchases = g.orders.filter(
      (o) => o.status === 'APPLIED' && o.note !== 'PLAN_QUOTA_RESET',
    );
    const originals = purchases.filter(
      (o) => !o.note?.startsWith(UPGRADE_NOTE),
    );
    // A renewal chain needs its own paid-period allocation; never guess a credit.
    if (originals.length !== 1)
      throw new ConflictException(
        '存在多笔续期或调整订单，暂需客服核算升级差价',
      );
    const original = originals[0];
    const complimentary =
      original.source === 'ADMIN' && original.amountCents === 0;
    // Only the original order's immutable list-price snapshot may value a gift.
    // Keep its recorded payment at zero; this is upgrade credit, not cash income.
    const originalValueCents = complimentary
      ? original.basePriceCents
      : original.amountCents;
    if (
      (!complimentary && !['PAYMENT', 'WALLET'].includes(original.source)) ||
      originalValueCents == null ||
      !Number.isSafeInteger(originalValueCents) ||
      originalValueCents <= 0 ||
      original.intervalMonthsSnapshot == null ||
      original.intervalMonthsSnapshot !== g.offer.intervalMonths
    )
      throw new ConflictException('无法核实剩余实付价值，请联系客服核算');
    let earlyActivationVerified = false;
    if (original.entitlementExpiresAt?.getTime() !== g.endsAt.getTime()) {
      // Early activation deliberately preserves the original payment snapshot.
      // Accept its new interval only when the exact order/grant and dates are audited.
      earlyActivationVerified = Boolean(
        original.entitlementExpiresAt &&
        (await tx.auditLog.findFirst({
          where: {
            action: 'entitlement.scheduled.activated',
            targetType: 'user',
            targetId: userId,
            AND: [
              { metadata: { path: ['result', 'grantId'], equals: g.id } },
              {
                metadata: { path: ['result', 'orderId'], equals: original.id },
              },
              {
                metadata: {
                  path: ['result', 'startsAt'],
                  equals: g.startsAt.toISOString(),
                },
              },
              {
                metadata: {
                  path: ['result', 'endsAt'],
                  equals: g.endsAt.toISOString(),
                },
              },
              {
                metadata: {
                  path: ['result', 'intervalMonths'],
                  equals: original.intervalMonthsSnapshot,
                },
              },
              {
                metadata: {
                  path: ['originalEndsAt'],
                  equals: original.entitlementExpiresAt.toISOString(),
                },
              },
            ],
          },
          select: { id: true },
        })),
      );
      if (!earlyActivationVerified)
        throw new ConflictException('无法核实剩余实付价值，请联系客服核算');
    }
    const group = await tx.groupBuyMember.findUnique({
      where: { orderId: original.id },
    });
    if (group)
      throw new ConflictException('拼团套餐涉及返还奖励，暂需客服核算升级差价');
    const anchor = original.processedAt ?? original.createdAt;
    const expectedEnd = new Date(g.startsAt);
    const day = expectedEnd.getUTCDate();
    expectedEnd.setUTCDate(1);
    expectedEnd.setUTCMonth(
      expectedEnd.getUTCMonth() + original.intervalMonthsSnapshot,
    );
    const lastDay = new Date(
      Date.UTC(expectedEnd.getUTCFullYear(), expectedEnd.getUTCMonth() + 1, 0),
    ).getUTCDate();
    expectedEnd.setUTCDate(Math.min(day, lastDay));
    if (expectedEnd.getTime() !== g.endsAt.getTime())
      throw new ConflictException('有效期与原购买周期不一致，请联系客服核算');
    // Admin free switches/validity edits must not silently change the purchased interval.
    if (
      Math.abs(anchor.getTime() - g.startsAt.getTime()) > 60_000 &&
      !earlyActivationVerified &&
      !original.note?.startsWith('PLAN_ACTIVATION:scheduled_switch')
    )
      throw new ConflictException('套餐生效时间曾调整，请联系客服核算');
    const state = upgradeFingerprint({
      id: g.id,
      product: g.productId,
      offer: g.offerId,
      start: g.startsAt,
      end: g.endsAt,
      anchor: g.resetAnchorAt,
      quota: g.trafficBytesSnapshot,
      profile: g.accessProfileId,
      up: g.speedUpMbpsSnapshot,
      down: g.speedDownMbpsSnapshot,
      devices: g.deviceLimitSnapshot,
      // Preserve fingerprints of existing paid quotes across this additive rule.
      ...(complimentary ? { adminListPrice: originalValueCents } : {}),
      bucket: [
        g.quotaBuckets[0].id,
        g.quotaBuckets[0].startsAt,
        g.quotaBuckets[0].endsAt,
        g.quotaBuckets[0].grantedBytes,
      ],
      orders: purchases.map((o) => [
        o.id,
        o.amountCents,
        o.status,
        o.note,
        o.entitlementExpiresAt,
        o.planUpgradeSnapshot,
      ]),
    });
    return {
      user,
      grant: g,
      original,
      purchases,
      state,
      complimentary,
      originalValueCents,
    };
  }

  async quote(
    tx: Prisma.TransactionClient,
    userId: string,
    offerId: string,
    token?: string,
    now = new Date(),
  ) {
    if (!this.cipher.enabled) throw new ConflictException('升级报价签名未配置');
    const current = await this.read(tx, userId, now);
    if (token) {
      const q = this.decode(token);
      this.assertCurrent(q, current, userId, offerId, now, true);
      return {
        data: q,
        token,
        remainingBytes: (
          current.grant.quotaBuckets[0].grantedBytes -
          current.grant.quotaBuckets[0].consumedBytes
        ).toString(),
      };
    }
    const offer = await tx.catalogOffer.findUnique({
      where: { id: offerId },
      include: catalogOfferSnapshotInclude,
    });
    const g = current.grant;
    if (
      !offer ||
      !offer.active ||
      offer.archivedAt ||
      offer.product.status !== 'ACTIVE' ||
      offer.product.kind !== 'PLAN' ||
      offer.product.series !== 'STANDARD' ||
      offer.product.id === g.productId ||
      offer.billingPeriod !== g.offer!.billingPeriod ||
      offer.intervalMonths !== g.offer!.intervalMonths ||
      !offer.product.legacyPlanId ||
      offer.priceCents <= g.offer!.priceCents ||
      offer.trafficBytes <= g.trafficBytesSnapshot!
    )
      throw new BadRequestException(
        '请选择同付款周期、价格和流量额度更高的普通套餐',
      );
    const target = snapshotCatalogOffer(offer);
    const reducesLimit = (before: number, after: number) =>
      after !== 0 && (before === 0 || after < before);
    if (
      reducesLimit(g.speedUpMbpsSnapshot, target.speedUpMbps) ||
      reducesLimit(g.speedDownMbpsSnapshot, target.speedDownMbps) ||
      reducesLimit(g.deviceLimitSnapshot, target.deviceLimit)
    )
      throw new BadRequestException(
        '目标套餐包含更低的速率或设备限制，不支持自动升级',
      );
    let creditBasis: NonNullable<StandardUpgradeQuote['creditBasis']> =
      current.complimentary ? 'admin_list_price' : 'actual_payment';
    let creditBasisCents = current.originalValueCents;
    let creditCents = remainingValue(
      creditBasisCents,
      g.startsAt,
      g.endsAt,
      now,
    );
    const upgrades = current.purchases.filter((o) =>
      o.note?.startsWith(UPGRADE_NOTE),
    );
    const previous = upgrades.at(-1);
    if (previous) {
      const prior =
        previous.planUpgradeSnapshot as unknown as StandardUpgradeQuote;
      if (prior?.purpose !== 'standard-plan-upgrade-v1')
        throw new ConflictException('原升级快照缺失，请联系客服');
      creditBasis = 'previous_upgrade';
      creditBasisCents = prior.targetRemainingCents;
      creditCents = remainingValue(
        prior.targetRemainingCents,
        new Date(prior.quotedAt),
        g.endsAt,
        now,
      );
    }
    const targetRemainingCents = remainingValue(
      offer.priceCents,
      g.startsAt,
      g.endsAt,
      now,
    );
    const payableCents = targetRemainingCents - creditCents;
    if (payableCents <= 0)
      throw new BadRequestException('当前无需补差或剩余期限过短，请联系客服');
    const q: StandardUpgradeQuote = {
      purpose: 'standard-plan-upgrade-v1',
      userId,
      grantId: g.id,
      state: current.state,
      quotedAt: now.toISOString(),
      expiresAt: new Date(
        Math.min(
          now.getTime() + 15 * 60_000,
          g.quotaBuckets[0].endsAt.getTime(),
          g.endsAt.getTime(),
        ),
      ).toISOString(),
      startsAt: g.startsAt.toISOString(),
      endsAt: g.endsAt.toISOString(),
      sourceOrderId: current.original.id,
      sourceProductName: g.product.name,
      sourceProductId: g.productId,
      sourceTrafficBytes: g.trafficBytesSnapshot!.toString(),
      sourcePaidCents: current.original.amountCents,
      creditBasis,
      creditBasisCents,
      targetPriceCents: offer.priceCents,
      creditCents,
      targetRemainingCents,
      payableCents,
      target,
    };
    return {
      data: q,
      token: this.cipher.encrypt(JSON.stringify(q)),
      remainingBytes: (
        g.quotaBuckets[0].grantedBytes - g.quotaBuckets[0].consumedBytes
      ).toString(),
    };
  }

  assertCurrent(
    q: StandardUpgradeQuote,
    current: Awaited<ReturnType<StandardPlanUpgrade['read']>>,
    userId: string,
    offerId: string,
    now: Date,
    checkExpiry: boolean,
  ) {
    if (
      q.userId !== userId ||
      q.target.offerId !== offerId ||
      q.state !== current.state ||
      q.grantId !== current.grant.id ||
      (checkExpiry && new Date(q.expiresAt) <= now) ||
      new Date(q.endsAt) <= now
    )
      throw new ConflictException(
        '升级报价已过期或套餐发生变化，请重新报价；已付款将进入补偿处理',
      );
  }
}
