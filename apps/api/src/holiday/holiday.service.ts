import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  Prisma,
  type EpayPaymentAttempt,
  type HolidayEntry,
  type HolidayCampaign,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommerceService } from '../commerce/commerce.service';
import {
  catalogOfferSnapshotInclude,
  snapshotCatalogOffer,
} from '../commerce/catalog-offer-snapshot';
import { PaymentFulfillmentRejectedError } from '../commerce/payment-fulfillment.error';
import { postWalletEntry } from '../wallet/wallet-ledger';
import { assertWalletCreditCapacity } from '../wallet/wallet-credit-capacity';
import { holidayTransaction } from './holiday-transaction';
import {
  grantHolidayInviteDraws,
  snapshotHolidayInviteReward,
  reverseHolidayInviteDraws,
} from './holiday-invite-draws';
import {
  DEFAULT_PRIZES,
  HOLIDAY_ID,
  type HolidayConfig,
  type HolidayPurchaseDto,
  type HolidayQuoteDto,
} from './holiday.dto';

type Tx = Prisma.TransactionClient;
type HolidayView = {
  campaign:
    | (Omit<HolidayCampaign, 'config'> & {
        config: HolidayConfig;
        live: boolean;
        drawOpen: boolean;
        canEarnDraw: boolean;
        prizes: { cents: number; count: number; probability: number }[];
      })
    | null;
  offers: {
    offerId: string;
    name: string;
    billingPeriod: string;
    trafficBytes: string;
    originalPriceCents: number;
    priceCents: number;
  }[];
  entries: Pick<
    HolidayEntry,
    | 'id'
    | 'kind'
    | 'tierId'
    | 'offerId'
    | 'orderId'
    | 'attemptId'
    | 'status'
    | 'amountCents'
    | 'giftCents'
    | 'drawState'
    | 'prizeCents'
    | 'createdAt'
    | 'drawnAt'
  >[];
  drawAvailable: number;
  claimedTierIds: string[];
  drawRecords?: {
    id: string;
    source: string;
    prizeCents: number;
    drawnAt: Date | null;
  }[];
};
const json = (value: unknown) => value as Prisma.InputJsonValue;
const configOf = (value: Prisma.JsonValue) => value as unknown as HolidayConfig;
export const holidayPrice = (cents: number, basis: number) =>
  Math.round((cents * basis) / 10000);
export function pickPrize(
  stock: HolidayConfig['prizes'],
  draw: (max: number) => number = randomInt,
) {
  const total = stock.reduce((n, p) => n + p.count, 0);
  if (!total) throw new ConflictException('抽奖名额已用完');
  let index = draw(total);
  for (let i = 0; i < stock.length; i++) {
    index -= stock[i].count;
    if (index < 0) return i;
  }
  throw new Error('Invalid prize selection');
}

@Injectable()
export class HolidayService {
  constructor(
    private readonly db: PrismaService,
    private readonly commerce: CommerceService,
  ) {}

  async defaults() {
    const offers = await this.db.catalogOffer.findMany({
      where: {
        active: true,
        archivedAt: null,
        billingPeriod: { in: ['QUARTERLY', 'YEARLY'] },
        product: {
          name: {
            in: ['Pro', 'Boost', 'Plus', 'Prime', 'Max', 'Elite', 'Spark'],
          },
          kind: 'PLAN',
          series: 'STANDARD',
        },
      },
      include: { product: true },
    });
    return {
      id: HOLIDAY_ID,
      title: '中秋·国庆活动',
      enabled: false,
      startsAt: new Date().toISOString(),
      endsAt: '2026-10-07T15:59:59.000Z',
      drawEndsAt: '2026-10-10T15:59:59.000Z',
      giftBudgetCents: 100000,
      revision: 0,
      config: {
        inviteRewardCents: 500,
        tiers: [
          { id: '26', amountCents: 2600, giftCents: 500 },
          { id: '38', amountCents: 3800, giftCents: 600 },
          { id: '50', amountCents: 5000, giftCents: 800 },
          { id: '68', amountCents: 6800, giftCents: 1200 },
          { id: '100', amountCents: 10000, giftCents: 2000 },
          { id: '200', amountCents: 20000, giftCents: 4500 },
        ],
        offers: offers.map((o) => ({
          offerId: o.id,
          discountBasisPoints: 8000,
          name: o.product.name,
          billingPeriod: o.billingPeriod,
        })),
        prizes: DEFAULT_PRIZES,
      },
    };
  }

  async view(userId?: string): Promise<HolidayView> {
    const campaign = await this.db.holidayCampaign.findUnique({
      where: { id: HOLIDAY_ID },
    });
    if (!campaign)
      return {
        campaign: null,
        offers: [],
        entries: [],
        drawAvailable: 0,
        claimedTierIds: [],
      };
    const cfg = configOf(campaign.config);
    const offers = await this.db.catalogOffer.findMany({
      where: {
        id: { in: cfg.offers.map((o) => o.offerId) },
        active: true,
        archivedAt: null,
        product: { status: 'ACTIVE', kind: 'PLAN', series: 'STANDARD' },
      },
      include: { product: true },
    });
    const entries = userId
      ? await this.db.holidayEntry.findMany({
          where: { campaignId: HOLIDAY_ID, userId },
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { attempt: { select: { fulfillmentStatus: true } } },
        })
      : [];
    const claims = userId
      ? await this.db.holidayEntry.findMany({
          where: { campaignId: HOLIDAY_ID, userId, claimKey: { not: null } },
          select: { tierId: true },
        })
      : [];
    const stock = campaign.prizeStock as unknown as HolidayConfig['prizes'];
    const total = stock.reduce((n, p) => n + p.count, 0);
    const live =
      campaign.enabled &&
      new Date() >= campaign.startsAt &&
      new Date() <= campaign.endsAt;
    const drawAvailable = userId
      ? await this.db.holidayDrawTicket.count({
          where: { campaignId: HOLIDAY_ID, userId, state: 'AVAILABLE' },
        })
      : 0;
    return {
      campaign: {
        ...campaign,
        config: cfg,
        live,
        prizes: stock.map((p) => ({
          ...p,
          probability: total ? p.count / total : 0,
        })),
        drawOpen: campaign.enabled && new Date() <= campaign.drawEndsAt,
        canEarnDraw:
          campaign.reservedDraws + 3 <=
          cfg.prizes.reduce((n, p) => n + p.count, 0),
      },
      offers: offers
        .sort(
          (a, b) =>
            ['Pro', 'Boost', 'Plus', 'Prime', 'Max', 'Elite', 'Spark'].indexOf(
              a.product.name,
            ) -
            ['Pro', 'Boost', 'Plus', 'Prime', 'Max', 'Elite', 'Spark'].indexOf(
              b.product.name,
            ),
        )
        .map((o) => ({
          offerId: o.id,
          name: o.product.name,
          billingPeriod: o.billingPeriod,
          trafficBytes: String(o.trafficBytes),
          originalPriceCents: o.priceCents,
          priceCents: holidayPrice(
            o.priceCents,
            cfg.offers.find((x) => x.offerId === o.id)!.discountBasisPoints,
          ),
        })),
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        tierId: e.tierId,
        offerId: e.offerId,
        orderId: e.orderId,
        attemptId: e.attemptId,
        status:
          e.attempt?.fulfillmentStatus === 'REFUND_PENDING'
            ? 'REFUND_PENDING'
            : e.attempt?.fulfillmentStatus === 'REFUNDED'
              ? 'REFUNDED'
              : e.status,
        amountCents: e.amountCents,
        giftCents: e.giftCents,
        drawState: e.drawState,
        prizeCents: e.prizeCents,
        createdAt: e.createdAt,
        drawnAt: e.drawnAt,
      })),
      drawAvailable,
      drawRecords: userId
        ? await this.db.holidayDrawTicket.findMany({
            where: { campaignId: HOLIDAY_ID, userId, state: 'DRAWN' },
            orderBy: { drawnAt: 'desc' },
            take: 50,
            select: { id: true, source: true, prizeCents: true, drawnAt: true },
          })
        : [],
      claimedTierIds: claims.flatMap((e) => (e.tierId ? [e.tierId] : [])),
    };
  }

  async adminView() {
    const [view, defaults, entries] = await Promise.all([
      this.view(),
      this.defaults(),
      this.db.holidayEntry.findMany({
        where: { campaignId: HOLIDAY_ID },
        select: {
          kind: true,
          status: true,
          amountCents: true,
          giftCents: true,
          prizeCents: true,
          paymentType: true,
          reviewReason: true,
          id: true,
          orderId: true,
          attempt: { select: { status: true, fulfillmentStatus: true } },
        },
      }),
    ]);
    // Gross receipts remain visible while a refund is pending or completed.
    const applied = entries.filter((e) =>
      ['APPLIED', 'REFUND_PENDING', 'REFUNDED'].includes(e.status),
    );
    return {
      ...view,
      defaults,
      stats: {
        externalReceiptsCents: entries
          .filter((e) => e.attempt?.status === 'SETTLED')
          .reduce((s, e) => s + e.amountCents, 0),
        topupPrincipalCents: applied
          .filter((e) => e.kind === 'TOPUP')
          .reduce((s, e) => s + e.amountCents, 0),
        giftCents: applied.reduce((s, e) => s + e.giftCents, 0),
        walletConsumptionCents: applied
          .filter((e) => e.paymentType === 'wallet')
          .reduce((s, e) => s + e.amountCents, 0),
        planSalesCents: applied
          .filter((e) => e.kind === 'PLAN')
          .reduce((s, e) => s + e.amountCents, 0),
        prizeCents:
          (
            await this.db.holidayDrawTicket.aggregate({
              where: { campaignId: HOLIDAY_ID, state: 'DRAWN' },
              _sum: { prizeCents: true },
            })
          )._sum.prizeCents ?? 0,
        refundedCents: entries
          .filter(
            (e) =>
              e.status === 'REFUNDED' ||
              e.attempt?.fulfillmentStatus === 'REFUNDED',
          )
          .reduce((s, e) => s + e.amountCents, 0),
        manualReview: entries.filter((e) => e.reviewReason),
        inviteCashCents:
          (
            await this.db.holidayInviteReward.aggregate({
              where: { campaignId: HOLIDAY_ID, status: 'REWARDED' },
              _sum: { amountCents: true },
            })
          )._sum.amountCents ?? 0,
        inviteManualReview: await this.db.holidayInviteReward.findMany({
          where: { campaignId: HOLIDAY_ID, status: 'MANUAL_REVIEW' },
          select: {
            id: true,
            inviterId: true,
            inviteeId: true,
            sourceOrderId: true,
            amountCents: true,
            reviewReason: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      },
    };
  }

  async save(raw: unknown, actorId: string) {
    const input = raw as Awaited<ReturnType<HolidayService['defaults']>>;
    const integer = (v: unknown, min = 0, max = 10000000) =>
      Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
    if (
      !input ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 80 ||
      typeof input.enabled !== 'boolean' ||
      !integer(input.revision) ||
      !integer(input.giftBudgetCents) ||
      !input.config
    )
      throw new BadRequestException('活动配置格式不正确');
    const start = new Date(input.startsAt),
      end = new Date(input.endsAt),
      drawEnd = new Date(input.drawEndsAt),
      cfg = input.config;
    if (
      !Number.isFinite(+start) ||
      !Number.isFinite(+end) ||
      !Number.isFinite(+drawEnd) ||
      end <= start ||
      drawEnd < end
    )
      throw new BadRequestException('活动时间不正确');
    if (
      !Array.isArray(cfg.tiers) ||
      !cfg.tiers.length ||
      cfg.tiers.length > 10 ||
      !Array.isArray(cfg.offers) ||
      cfg.offers.length > 100 ||
      !Array.isArray(cfg.prizes) ||
      !cfg.prizes.length ||
      cfg.prizes.length > 20
    )
      throw new BadRequestException('活动档位格式不正确');
    if (
      (cfg.inviteRewardCents !== undefined &&
        !integer(cfg.inviteRewardCents, 0, 100000)) ||
      cfg.tiers.some(
        (t) =>
          !t ||
          typeof t.id !== 'string' ||
          !/^[-\w]{1,30}$/.test(t.id) ||
          !integer(t.amountCents, 1) ||
          !integer(t.giftCents),
      ) ||
      new Set(cfg.tiers.map((t) => t.id)).size !== cfg.tiers.length ||
      cfg.offers.some(
        (o) =>
          !o ||
          typeof o.offerId !== 'string' ||
          !integer(o.discountBasisPoints, 100, 10000),
      ) ||
      new Set(cfg.offers.map((o) => o.offerId)).size !== cfg.offers.length ||
      cfg.prizes.some(
        (p) => !p || !integer(p.cents) || !integer(p.count, 0, 10000),
      ) ||
      new Set(cfg.prizes.map((p) => p.cents)).size !== cfg.prizes.length ||
      cfg.prizes.reduce((n, p) => n + p.count, 0) < 1 ||
      cfg.prizes.reduce((n, p) => n + p.cents * p.count, 0) > 20000
    )
      throw new BadRequestException(
        '请检查金额、折扣、唯一档位和不超过200元的奖池',
      );
    return holidayTransaction(this.db, async (tx) => {
      const old = await tx.holidayCampaign.findUnique({
        where: { id: HOLIDAY_ID },
      });
      if (old) {
        await this.lock(tx);
        if (old.revision !== input.revision)
          throw new ConflictException('配置已更新，请刷新');
      }
      const count =
        (await tx.holidayEntry.count({ where: { campaignId: HOLIDAY_ID } })) +
        (await tx.holidayDrawTicket.count({
          where: { campaignId: HOLIDAY_ID },
        })) +
        (await tx.holidayInviteReward.count({
          where: { campaignId: HOLIDAY_ID },
        }));
      if (count && old) {
        if (drawEnd < old.drawEndsAt)
          throw new BadRequestException(
            '已有参与记录，不能缩短已承诺的抽奖期限',
          );
        const prior = configOf(old.config);
        if (
          JSON.stringify(prior.tiers) !== JSON.stringify(cfg.tiers) ||
          (prior.inviteRewardCents ?? 500) !== (cfg.inviteRewardCents ?? 500) ||
          JSON.stringify(prior.prizes) !== JSON.stringify(cfg.prizes)
        )
          throw new BadRequestException(
            '已有参与记录，充值档位、邀请奖励和奖池不可重设',
          );
      }
      if (old && input.giftBudgetCents < old.reservedGiftCents)
        throw new BadRequestException('预算不能小于已承诺赠额');
      const valid = await tx.catalogOffer.count({
        where: {
          id: { in: cfg.offers.map((o) => o.offerId) },
          active: true,
          archivedAt: null,
          billingPeriod: { in: ['QUARTERLY', 'YEARLY'] },
          product: {
            kind: 'PLAN',
            series: 'STANDARD',
            name: {
              in: ['Pro', 'Boost', 'Plus', 'Prime', 'Max', 'Elite', 'Spark'],
            },
          },
        },
      });
      if (valid !== cfg.offers.length)
        throw new BadRequestException('仅支持Pro及以上普通套餐季付、年付');
      const data = {
        title: input.title.trim(),
        enabled: input.enabled,
        startsAt: start,
        endsAt: end,
        drawEndsAt: drawEnd,
        giftBudgetCents: input.giftBudgetCents,
        config: json(cfg),
      };
      const result = old
        ? await tx.holidayCampaign.update({
            where: { id: HOLIDAY_ID },
            data: {
              ...data,
              revision: { increment: 1 },
              ...(!count ? { prizeStock: json(cfg.prizes) } : {}),
            },
          })
        : await tx.holidayCampaign.create({
            data: { id: HOLIDAY_ID, ...data, prizeStock: json(cfg.prizes) },
          });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'HOLIDAY_CONFIG_UPDATED',
          targetType: 'HolidayCampaign',
          targetId: HOLIDAY_ID,
          metadata: json({ before: old, after: result }),
        },
      });
      return { ok: true };
    });
  }

  async quote(userId: string, input: HolidayQuoteDto) {
    const [view, quote] = await Promise.all([
      this.view(userId),
      this.commerce.quoteCheckout(userId, {
        offerId: input.offerId,
        planActivation: input.planActivation,
      }),
    ]);
    const offer = view.offers.find((o) => o.offerId === input.offerId);
    if (!view.campaign?.live || !offer)
      throw new BadRequestException('活动未开放或商品不参加活动');
    return {
      ...quote,
      finalPriceCents: offer.priceCents,
      sufficient: quote.balanceCents >= offer.priceCents,
      revision: view.campaign.revision,
      expectsDraw: view.campaign.canEarnDraw,
    };
  }

  private async lock(tx: Tx) {
    if (
      !(await tx.holidayCampaign.findUnique({
        where: { id: HOLIDAY_ID },
        select: { id: true },
      }))
    )
      throw new ConflictException('活动尚未开放');
    return tx.holidayCampaign.update({
      where: { id: HOLIDAY_ID },
      data: { revision: { increment: 0 } },
    });
  }

  async prepare(
    tx: Tx,
    userId: string,
    input: HolidayPurchaseDto,
    key: string,
  ) {
    if (!key.trim() || key.length > 100)
      throw new BadRequestException('请提供有效的幂等键');
    const prior = await tx.holidayEntry.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    });
    if (prior) {
      const snap = prior.snapshot as Record<string, Prisma.JsonValue>;
      if (
        prior.kind !== input.kind ||
        prior.offerId !== (input.offerId ?? null) ||
        prior.tierId !== (input.tierId ?? null) ||
        prior.paymentType !== input.paymentType ||
        snap.preference !== (input.planActivation ?? 'scheduled_switch')
      )
        throw new ConflictException('该请求编号已用于其他活动购买');
      return prior;
    }
    const c = await this.lock(tx),
      now = new Date(),
      cfg = configOf(c.config);
    if (
      !c.enabled ||
      now < c.startsAt ||
      now > c.endsAt ||
      c.revision !== input.revision
    )
      throw new ConflictException('活动未开放或配置已更新，请刷新');
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE')
      throw new BadRequestException('账户不可参与');
    let amount = 0,
      gift = 0,
      snapshot: Record<string, unknown> = {
        preference: input.planActivation ?? 'scheduled_switch',
      },
      claimKey: string | null = null;
    if (input.kind === 'TOPUP') {
      if (input.paymentType === 'wallet' || input.offerId)
        throw new BadRequestException('充值仅支持外部支付');
      const tier = cfg.tiers.find((t) => t.id === input.tierId);
      if (!tier) throw new BadRequestException('充值档位不存在');
      amount = tier.amountCents;
      gift = tier.giftCents;
      claimKey = `${HOLIDAY_ID}:${userId}:${tier.id}`;
      if (await tx.holidayEntry.findUnique({ where: { claimKey } }))
        throw new ConflictException(
          '该档位已参与或有待处理支付，请查看活动记录',
        );
      if (c.reservedGiftCents + gift > c.giftBudgetCents)
        throw new ConflictException('充值赠额预算已用完');
    } else {
      if (input.tierId || !input.offerId)
        throw new BadRequestException('请选择活动套餐');
      const setting = cfg.offers.find((o) => o.offerId === input.offerId);
      const offer = await tx.catalogOffer.findUnique({
        where: { id: input.offerId },
        include: catalogOfferSnapshotInclude,
      });
      if (
        !setting ||
        !offer ||
        !offer.active ||
        offer.archivedAt ||
        offer.product.kind !== 'PLAN' ||
        offer.product.series !== 'STANDARD' ||
        !['Pro', 'Boost', 'Plus', 'Prime', 'Max', 'Elite', 'Spark'].includes(
          offer.product.name,
        ) ||
        !['QUARTERLY', 'YEARLY'].includes(offer.billingPeriod)
      )
        throw new BadRequestException('活动套餐不可用');
      const quote = await this.commerce.quoteCheckout(
        userId,
        {
          offerId: input.offerId,
          planActivation: input.planActivation,
        },
        tx,
      );
      if (
        quote.planActivationMode === 'immediate_switch' &&
        !input.immediateConfirmed
      )
        throw new BadRequestException('立即切换须确认放弃旧套餐剩余时间和流量');
      amount = holidayPrice(offer.priceCents, setting.discountBasisPoints);
      snapshot = {
        ...snapshot,
        basePriceCents: offer.priceCents,
        catalog: snapshotCatalogOffer(offer, {
          purchaseMode: quote.purchaseMode,
          planActivationPreference: input.planActivation ?? 'scheduled_switch',
          planActivationMode: quote.planActivationMode,
          planEffectiveAt: quote.planEffectiveAt,
          currentPlanProductId: quote.currentPlanProductId,
          currentPlanName: quote.currentPlanName,
          currentPlanEndsAt: quote.currentPlanEndsAt,
        }),
        productName: offer.product.name,
      };
      (snapshot.catalog as Record<string, unknown>).campaignPriceCents = amount;
      (snapshot.catalog as Record<string, unknown>).campaignId = HOLIDAY_ID;
    }
    const draw =
      c.reservedDraws + 3 <= cfg.prizes.reduce((n, p) => n + p.count, 0);
    if (amount !== input.expectedPriceCents || draw !== input.expectsDraw)
      throw new ConflictException('价格或抽奖名额已变化，请刷新确认');
    if (input.paymentType === 'wallet' && user.balanceCents < amount)
      throw new BadRequestException('账户余额不足，请先充值或选择外部支付');
    await tx.holidayCampaign.update({
      where: { id: HOLIDAY_ID },
      data: {
        reservedGiftCents: { increment: gift },
        reservedDraws: { increment: draw ? 3 : 0 },
      },
    });
    const entry = await tx.holidayEntry.create({
      data: {
        campaignId: HOLIDAY_ID,
        userId,
        kind: input.kind,
        tierId: input.tierId,
        claimKey,
        offerId: input.offerId,
        paymentType: input.paymentType,
        idempotencyKey: key,
        amountCents: amount,
        giftCents: gift,
        snapshot: json({
          ...snapshot,
          holidayInviteRewardId:
            input.kind === 'TOPUP'
              ? await snapshotHolidayInviteReward(tx, userId)
              : null,
        }),
        drawReserved: draw,
        drawState: draw ? 'RESERVED' : 'NONE',
      },
    });
    if (draw)
      await tx.holidayDrawTicket.createMany({
        data: [0, 1, 2].map((i) => ({
          campaignId: HOLIDAY_ID,
          userId,
          entryId: entry.id,
          source: 'ORDER',
          sourceKey: `order:${entry.id}:${i}`,
        })),
      });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'HOLIDAY_RESERVED',
        targetType: 'HolidayEntry',
        targetId: entry.id,
        metadata: { amountCents: amount, giftCents: gift, drawReserved: draw },
      },
    });
    return entry;
  }

  async fulfill(
    tx: Tx,
    entry: HolidayEntry,
    attempt: EpayPaymentAttempt | null,
    tradeNo: string,
    paidAt: Date,
  ) {
    await this.lock(tx);
    const current = await tx.holidayEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    if (current.status === 'APPLIED') return { orderId: current.orderId! };
    if (
      current.status !== 'RESERVED' ||
      (attempt && paidAt > attempt.expiresAt)
    )
      throw new PaymentFulfillmentRejectedError(
        'HOLIDAY_EXPIRED',
        '活动订单已关闭或付款超时，将按支付补偿流程退款',
      );
    const snap = current.snapshot as Record<string, Prisma.JsonValue>;
    let orderId: string;
    if (current.kind === 'TOPUP') {
      if (!attempt) throw new BadRequestException('充值必须外部付款');
      await assertWalletCreditCapacity(
        tx,
        current.userId,
        current.amountCents + current.giftCents,
      );
      const order = await tx.manualOrder.create({
        data: {
          userId: current.userId,
          kind: 'WALLET_TOPUP',
          source: 'PAYMENT',
          status: 'APPLIED',
          amountCents: current.amountCents,
          basePriceCents: current.amountCents,
          productNameSnapshot: '节日余额充值',
          idempotencyKey: `holiday:${current.id}`,
          processedAt: paidAt,
        },
      });
      orderId = order.id;
      await tx.paymentRecord.create({
        data: {
          orderId,
          userId: current.userId,
          source: 'EPAY',
          status: 'SETTLED',
          amountCents: current.amountCents,
          externalRef: tradeNo,
          paidAt,
        },
      });
      for (const [suffix, amount, note] of [
        ['principal', current.amountCents, '充值本金'],
        ['gift', current.giftCents, '活动赠額'],
      ] as const)
        await postWalletEntry(tx, {
          userId: current.userId,
          orderId,
          amountCents: amount,
          kind: suffix === 'principal' ? 'TOPUP' : 'ADJUST',
          idempotencyKey: `holiday:${current.id}:${suffix}`,
          note: `中秋国庆${note}`,
        });
    } else {
      const common = {
        userId: current.userId,
        offerId: current.offerId!,
        amountCents: current.amountCents,
        basePriceCents: Number(snap.basePriceCents),
        entitlementSnapshot: snap.catalog,
        paidAt,
      };
      const order = attempt
        ? await this.commerce.fulfillEpayPayment(tx, {
            ...common,
            attemptId: attempt.id,
            merchantOrderNo: attempt.merchantOrderNo,
            gatewayTradeNo: tradeNo,
          })
        : await this.commerce.fulfillHolidayWalletPayment(tx, {
            ...common,
            entryId: current.id,
          });
      orderId = order.orderId;
    }
    await tx.holidayEntry.update({
      where: { id: current.id },
      data: {
        status: 'APPLIED',
        orderId,
        fulfilledAt: paidAt,
        drawState: current.drawReserved ? 'AVAILABLE' : 'NONE',
      },
    });
    await tx.holidayDrawTicket.updateMany({
      where: { entryId: current.id, state: 'RESERVED' },
      data: { state: 'AVAILABLE', sourceOrderId: orderId },
    });
    if (current.kind === 'TOPUP')
      await grantHolidayInviteDraws(
        tx,
        current.userId,
        orderId,
        paidAt,
        snap.holidayInviteRewardId as string | null | undefined,
      );
    await tx.auditLog.create({
      data: {
        action: 'HOLIDAY_APPLIED',
        targetType: 'HolidayEntry',
        targetId: current.id,
        metadata: { userId: current.userId, orderId },
      },
    });
    return { orderId };
  }

  async closePayment(tx: Tx, attemptId: string) {
    const entry = await tx.holidayEntry.findUnique({ where: { attemptId } });
    if (!entry || entry.status !== 'RESERVED') return;
    await this.lock(tx);
    const changed = await tx.holidayEntry.updateMany({
      where: { id: entry.id, status: 'RESERVED' },
      data: {
        status: 'CLOSED',
        claimKey: null,
        drawReserved: false,
        drawState: 'REVOKED',
      },
    });
    if (changed.count) {
      const released = await tx.holidayDrawTicket.updateMany({
        where: { entryId: entry.id, state: 'RESERVED' },
        data: { state: 'REVOKED' },
      });
      await tx.holidayCampaign.update({
        where: { id: HOLIDAY_ID },
        data: {
          reservedGiftCents: { decrement: entry.giftCents },
          reservedDraws: { decrement: released.count },
        },
      });
    }
  }

  async draw(userId: string, key: string) {
    if (!key.trim() || key.length > 100)
      throw new BadRequestException('请提供有效的幂等键');
    return holidayTransaction(this.db, async (tx) => {
      const c = await this.lock(tx),
        drawKey = `${userId}:${key}`;
      const replay = await tx.holidayDrawTicket.findUnique({
        where: { drawKey },
      });
      if (replay)
        return {
          entryId: replay.entryId ?? replay.id,
          prizeCents: replay.prizeCents,
        };
      if (!c.enabled || new Date() > c.drawEndsAt)
        throw new BadRequestException('抽奖已结束或暂停');
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.deletedAt || user.status !== 'ACTIVE')
        throw new BadRequestException('账户不可参与');
      const ticket = await tx.holidayDrawTicket.findFirst({
        where: {
          campaignId: HOLIDAY_ID,
          userId,
          state: 'AVAILABLE',
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!ticket) throw new BadRequestException('暂无抽奖机会');
      const stock = c.prizeStock as unknown as HolidayConfig['prizes'],
        index = pickPrize(stock),
        prize = stock[index].cents;
      stock[index].count--;
      await tx.holidayCampaign.update({
        where: { id: HOLIDAY_ID },
        data: { prizeStock: json(stock) },
      });
      await postWalletEntry(tx, {
        userId,
        orderId: ticket.sourceOrderId ?? undefined,
        amountCents: prize,
        kind: 'ADJUST',
        idempotencyKey: `holiday-ticket:${ticket.id}:prize`,
        note: '国庆幸运抽奖奖励',
      });
      await tx.holidayDrawTicket.update({
        where: { id: ticket.id },
        data: {
          drawKey,
          state: 'DRAWN',
          prizeCents: prize,
          drawnAt: new Date(),
        },
      });
      if (ticket.entryId) {
        const remaining = await tx.holidayDrawTicket.count({
          where: { entryId: ticket.entryId, state: 'AVAILABLE' },
        });
        await tx.holidayEntry.update({
          where: { id: ticket.entryId },
          data: {
            prizeCents: { increment: prize },
            drawState: remaining ? 'AVAILABLE' : 'DRAWN',
            drawnAt: new Date(),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'HOLIDAY_DRAWN',
          targetType: 'HolidayDrawTicket',
          targetId: ticket.id,
          metadata: { prizeCents: prize },
        },
      });
      return { entryId: ticket.entryId ?? ticket.id, prizeCents: prize };
    });
  }

  async reverse(
    tx: Tx,
    orderId: string,
    fullRefund: boolean,
    method: string,
    actorId: string,
  ) {
    const e = await tx.holidayEntry.findUnique({ where: { orderId } });
    if (!e) return null;
    await this.lock(tx);
    if (e.status === 'REFUNDED' || e.status === 'REFUND_PENDING')
      throw new ConflictException('活动订单已退款或正在退款');
    let reason: string | null = null;
    if (!fullRefund) reason = '活动订单暂仅支持全额退款，请人工核验';
    if (e.kind === 'TOPUP' && method !== 'original')
      reason = '充值订单请使用原路自动退款，不能再次退入余额或重复登记转账';
    if (
      e.kind === 'TOPUP' &&
      (await tx.walletLedgerEntry.count({
        where: {
          userId: e.userId,
          amountCents: { lt: 0 },
          createdAt: { gte: e.fulfilledAt! },
        },
      }))
    )
      reason = '充值后已有余额支出，请人工核验本金、赠额和消费';
    const recover =
      (e.kind === 'TOPUP' ? e.amountCents + e.giftCents : 0) + e.prizeCents;
    const user = await tx.user.findUniqueOrThrow({ where: { id: e.userId } });
    if (user.balanceCents < recover)
      reason = '余额不足以追回活动奖励，请人工处理';
    if (!reason) reason = await reverseHolidayInviteDraws(tx, orderId);
    if (reason) {
      await tx.holidayEntry.update({
        where: { id: e.id },
        data: { reviewReason: reason },
      });
      return reason;
    }
    await tx.holidayDrawTicket.updateMany({
      where: { entryId: e.id, state: 'AVAILABLE' },
      data: { state: 'REVOKED' },
    });
    await postWalletEntry(tx, {
      userId: e.userId,
      actorId,
      orderId,
      amountCents: -recover,
      kind: 'ADJUST',
      idempotencyKey: `holiday:${e.id}:refund`,
      note: '活动退款追回本金及奖励',
    });
    if (e.kind === 'TOPUP') {
      if (!e.attemptId) throw new ConflictException('充值支付关联缺失');
      await tx.epayRefundAttempt.create({
        data: {
          paymentAttemptId: e.attemptId,
          amountCents: e.amountCents,
          reasonCode: 'HOLIDAY_TOPUP_REFUND',
        },
      });
      await tx.epayPaymentAttempt.update({
        where: { id: e.attemptId },
        data: { fulfillmentStatus: 'REFUND_PENDING' },
      });
      await tx.refund.create({
        data: {
          orderId,
          processedById: actorId,
          method: 'EPAY',
          status: 'PENDING',
          amountCents: e.amountCents,
          reason: '活动充值原路退款',
        },
      });
    }
    await tx.holidayEntry.update({
      where: { id: e.id },
      data: {
        status: e.kind === 'TOPUP' ? 'REFUND_PENDING' : 'REFUNDED',
        drawState: e.drawState === 'DRAWN' ? 'DRAWN' : 'REVOKED',
        reviewReason: null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'HOLIDAY_REFUND_RECOVERY',
        targetType: 'HolidayEntry',
        targetId: e.id,
        metadata: {
          orderId,
          recoveredCents: recover,
          originalRefund: e.kind === 'TOPUP',
        },
      },
    });
    return null;
  }

  async confirmRefund(tx: Tx, attemptId: string) {
    const e = await tx.holidayEntry.findUnique({ where: { attemptId } });
    if (!e) return;
    if (e.status === 'RESERVED') {
      await this.closePayment(tx, attemptId);
      return;
    }
    if (e.status === 'REFUND_PENDING') {
      await this.lock(tx);
      await tx.holidayEntry.update({
        where: { id: e.id },
        data: { status: 'REFUNDED', reviewReason: null },
      });
      await tx.refund.updateMany({
        where: { orderId: e.orderId!, status: 'PENDING', method: 'EPAY' },
        data: { status: 'APPLIED', processedAt: new Date() },
      });
    }
  }
}
