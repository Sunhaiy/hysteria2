import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BillingPeriod,
  CatalogProductKind,
  CatalogProductSeries,
  CatalogProductStatus,
  GroupBuyMemberStatus,
  OrderKind,
  OrderSource,
  OrderStatus,
  QuotaCadence,
  RedemptionCodeKind,
  RedemptionCodeStatus,
  type Prisma,
  SubscriptionStatus,
  TrafficPackStatus,
  UserStatus,
} from '@prisma/client';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import {
  isPermanentBillingPeriod,
  permanentEntitlementEnd,
} from '../entitlement/entitlement-lifetime';
import { PaymentFulfillmentRejectedError } from './payment-fulfillment.error';
import { ReferralService } from '../referrals/referral.service';
import {
  assertCatalogPurchaseEligibility,
  assertCatalogPurchaseLimit,
} from './purchase-eligibility';
import {
  catalogOfferSnapshotInclude,
  parseCatalogOfferSnapshot,
  snapshotCatalogOffer,
  type CatalogOfferSnapshot,
} from './catalog-offer-snapshot';
import { postWalletEntry } from '../wallet/wallet-ledger';
import {
  decidePlanPurchasePolicy,
  standardPlanPurchaseKey,
  type PlanActivationPreference,
  type PlanPurchasePolicy,
} from './plan-purchase-policy';

export type CheckoutInput =
  | {
      offerId: string;
      discountCode?: string;
      purchaseAction?: 'purchase' | 'plan_reset';
      planActivation?: PlanActivationPreference;
    }
  | { kind: 'plan'; productId: string; discountCode?: string }
  | { kind: 'plan_offer'; productId: string; discountCode?: string }
  | { kind: 'traffic_pack'; productId: string; discountCode?: string };

export interface CheckoutResult {
  orderId: string;
  replayed: boolean;
  kind?: 'plan' | 'plan_offer' | 'traffic_pack';
  productName?: string;
  chargedCents?: number;
  entitlementExpiresAt?: string;
}

export interface EpaySettlementInput {
  attemptId: string;
  userId: string;
  offerId: string;
  merchantOrderNo: string;
  gatewayTradeNo: string;
  amountCents: number;
  basePriceCents: number;
  entitlementSnapshot: Prisma.JsonValue | null;
  paidAt: Date;
  entitlementStartsAt?: Date;
}

export interface GroupBuyWalletSettlementInput {
  userId: string;
  offerId: string;
  memberId: string;
  amountCents: number;
  basePriceCents: number;
  entitlementSnapshot: Prisma.JsonValue;
  paidAt: Date;
}

interface PlanResetSettlementInput {
  userId: string;
  offerId: string;
  amountCents: number;
  basePriceCents: number;
  paidAt: Date;
  epay?: {
    attemptId: string;
    gatewayTradeNo: string;
  };
}

const PLAN_RESET_PRICE_PERCENT = 70;
const PLAN_RESET_ORDER_NOTE = 'PLAN_QUOTA_RESET';

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ControlPlaneStoreService,
    @Optional() private readonly entitlements?: EntitlementService,
    @Optional() private readonly referrals?: ReferralService,
  ) {}

  async quoteCheckout(userId: string, input: CheckoutInput) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Account is not active');
    }

    const product = await this.resolveQuoteProduct(input);
    const planReset =
      'offerId' in input && input.purchaseAction === 'plan_reset'
        ? await this.resolvePlanReset(this.prisma, userId, input.offerId)
        : null;
    if (planReset && input.discountCode) {
      throw new BadRequestException('本期流量重置不支持叠加优惠码');
    }
    const ultraPurchase =
      !planReset && product.series === CatalogProductSeries.ULTRA
        ? await this.resolveUltraPurchase(this.prisma, userId, {
            id: product.productId,
            name: product.productName,
            priceCents: product.priceCents,
            trafficBytes: product.trafficBytes,
          })
        : null;
    const standardPlanPurchase =
      !planReset &&
      'offerId' in input &&
      product.series === CatalogProductSeries.STANDARD &&
      product.purchaseRules?.kind === CatalogProductKind.PLAN &&
      product.purchaseRules.legacyPlanId
        ? await this.resolveStandardPlanPurchasePolicy(
            this.prisma,
            userId,
            {
              productId: product.productId,
              productName: product.productName,
              legacyPlanId: product.purchaseRules.legacyPlanId,
            },
            input.planActivation,
          )
        : null;
    if (product.purchaseRules && !ultraPurchase && !planReset) {
      await assertCatalogPurchaseEligibility(
        this.prisma,
        userId,
        product.purchaseRules,
      );
    }

    const payableBeforeDiscountCents =
      planReset?.payableCents ??
      ultraPurchase?.payableCents ??
      product.priceCents;
    const discount =
      input.discountCode && !planReset
        ? await this.previewDiscount(
            this.prisma,
            userId,
            input.discountCode,
            payableBeforeDiscountCents,
          )
        : null;
    const finalPriceCents = Math.max(
      payableBeforeDiscountCents - (discount?.discountCents ?? 0),
      0,
    );
    return {
      kind: 'kind' in input ? input.kind : product.kind,
      productId: product.id,
      productName: planReset
        ? `${product.productName} · 本期流量重置`
        : product.name,
      basePriceCents: product.priceCents,
      discountCents: planReset
        ? product.priceCents - planReset.payableCents
        : (discount?.discountCents ?? 0),
      discountLabel: planReset
        ? `本期流量重置 ${PLAN_RESET_PRICE_PERCENT / 10} 折`
        : (discount?.label ?? null),
      finalPriceCents,
      balanceCents: user.balanceCents,
      sufficient: user.balanceCents >= finalPriceCents,
      purchaseMode: planReset
        ? ('plan_reset' as const)
        : (ultraPurchase?.mode ?? ('initial' as const)),
      upgradeFromGrantId: ultraPurchase?.grantId ?? null,
      upgradeFromProductId: ultraPurchase?.productId ?? null,
      upgradeFromProductName: ultraPurchase?.productName ?? null,
      upgradeFromPriceCents: ultraPurchase?.priceCents ?? null,
      resetAnchorAt: ultraPurchase?.resetAnchorAt?.toISOString() ?? null,
      resetGrantId: planReset?.grantId ?? null,
      resetBucketId: planReset?.bucketId ?? null,
      resetCycleStartsAt: planReset?.cycleStartsAt.toISOString() ?? null,
      resetCycleEndsAt: planReset?.cycleEndsAt.toISOString() ?? null,
      resetTrafficBytes: planReset?.targetBytes.toString() ?? null,
      resetCurrentRemainingBytes:
        planReset === null ? null : Number(planReset.currentRemainingBytes),
      resetCreditBytes:
        planReset === null ? null : Number(planReset.creditBytes),
      resetExpiresAt: planReset?.cycleEndsAt.toISOString() ?? null,
      planActivationMode: standardPlanPurchase?.mode ?? null,
      planEffectiveAt: standardPlanPurchase?.effectiveAt.toISOString() ?? null,
      currentPlanProductId:
        standardPlanPurchase?.currentPlan?.productId ?? null,
      currentPlanName: standardPlanPurchase?.currentPlan?.productName ?? null,
      currentPlanEndsAt:
        standardPlanPurchase?.currentPlan?.endsAt.toISOString() ?? null,
      forfeitedDays: standardPlanPurchase?.forfeitedDays ?? 0,
    };
  }

  async redeem(
    userId: string,
    code: string,
    expectedTrafficPackProductId?: string,
  ) {
    return this.store.redeemRedemptionCode(
      userId,
      code,
      expectedTrafficPackProductId,
      this.entitlements
        ? async ({ tx, code: redeemedCode, order }) => {
            if (!order?.catalogOfferId || !this.entitlements) return;
            if (
              redeemedCode.kind === RedemptionCodeKind.PLAN &&
              order.kind === OrderKind.RENEWAL
            ) {
              const subscription = await tx.subscription.findFirst({
                where: {
                  userId,
                  status: SubscriptionStatus.ACTIVE,
                },
                orderBy: { updatedAt: 'desc' },
              });
              const grant = await this.entitlements.grantFromOrder(
                {
                  orderId: order.id,
                  subscriptionId: subscription?.id,
                  replacePlan: redeemedCode.planMode === 'REPLACE',
                },
                tx,
              );
              if (this.referrals) {
                await this.referrals.settlePlanPurchaseReward(
                  tx,
                  userId,
                  order.id,
                  grant.id,
                );
              }
              return;
            }
            if (
              redeemedCode.kind === RedemptionCodeKind.TRAFFIC_PACK &&
              order.kind === OrderKind.TRAFFIC_PACK
            ) {
              if (
                !order.trafficBytes ||
                !order.entitlementExpiresAt ||
                !order.accessProfileIdSnapshot
              ) {
                throw new ConflictException(
                  'Traffic pack order is missing its entitlement snapshot',
                );
              }
              const trafficPack = await tx.trafficPack.findFirst({
                where: {
                  userId,
                  trafficPackProductId: order.trafficPackProductId,
                  totalBytes: order.trafficBytes,
                  expiresAt: isPermanentBillingPeriod(
                    order.billingPeriodSnapshot,
                  )
                    ? null
                    : order.entitlementExpiresAt,
                  accessProfileId: order.accessProfileIdSnapshot,
                },
                orderBy: { createdAt: 'desc' },
              });
              if (!trafficPack) {
                throw new ConflictException(
                  'Traffic pack entitlement source was not created',
                );
              }
              await this.entitlements.grantFromOrder(
                { orderId: order.id, trafficPackId: trafficPack.id },
                tx,
              );
            }
          }
        : undefined,
    );
  }

  async checkout(
    userId: string,
    input: CheckoutInput,
    idempotencyKey: string,
  ): Promise<CheckoutResult> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 120) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.manualOrder.findUnique({
              where: {
                userId_idempotencyKey: {
                  userId,
                  idempotencyKey: normalizedKey,
                },
              },
            });
            if (existing) return this.replayCheckout(existing, input);
            return this.createCheckout(tx, userId, input, normalizedKey);
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (!this.isRetryableTransactionError(error)) throw error;
        const existing = await this.prisma.manualOrder.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: normalizedKey,
            },
          },
        });
        if (existing) return this.replayCheckout(existing, input);
        if (attempt === 2) throw error;
      }
    }
    throw new ConflictException('Checkout transaction could not be completed');
  }

  async grantComplimentaryPlan(
    userId: string,
    offerId: string,
    actorId: string,
    idempotencyKey: string,
  ) {
    return this.grantComplimentaryOffer(
      userId,
      offerId,
      idempotencyKey,
      CatalogProductKind.PLAN,
      {
        actorId,
        auditAction: 'COMPLIMENTARY_PLAN_GRANTED',
      },
    );
  }

  async grantAnniversaryTrafficPack(
    userId: string,
    offerId: string,
    idempotencyKey: string,
  ) {
    return this.grantComplimentaryOffer(
      userId,
      offerId,
      idempotencyKey,
      CatalogProductKind.TRAFFIC_PACK,
      { auditAction: 'ANNIVERSARY_GIFT_CLAIMED' },
    );
  }

  private async grantComplimentaryOffer(
    userId: string,
    offerId: string,
    idempotencyKey: string,
    expectedKind: CatalogProductKind,
    audit: { actorId?: string; auditAction: string },
  ) {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 120) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.manualOrder.findUnique({
              where: {
                userId_idempotencyKey: {
                  userId,
                  idempotencyKey: normalizedKey,
                },
              },
            });
            if (existing) {
              return this.replayCheckout(existing, { offerId });
            }
            return this.createOfferCheckout(
              tx,
              userId,
              { offerId },
              normalizedKey,
              {
                complimentary: true,
                complimentaryKind: expectedKind,
                actorId: audit.actorId,
                complimentaryAuditAction: audit.auditAction,
              },
            );
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (!this.isRetryableTransactionError(error)) throw error;
        const existing = await this.prisma.manualOrder.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: normalizedKey,
            },
          },
        });
        if (existing) return this.replayCheckout(existing, { offerId });
        if (attempt === 2) throw error;
      }
    }
    throw new ConflictException('Complimentary grant could not be completed');
  }

  async fulfillEpayPayment(
    tx: Prisma.TransactionClient,
    input: EpaySettlementInput,
  ) {
    const idempotencyKey = `epay:${input.merchantOrderNo}`;
    const existing = await tx.manualOrder.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: input.userId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      return this.replayCheckout(existing, { offerId: input.offerId });
    }
    try {
      const snapshot = parseCatalogOfferSnapshot(input.entitlementSnapshot);
      if (snapshot?.purchaseMode === 'plan_reset') {
        return await this.fulfillPlanReset(
          tx,
          {
            userId: input.userId,
            offerId: input.offerId,
            amountCents: input.amountCents,
            basePriceCents: input.basePriceCents,
            paidAt: input.paidAt,
            epay: {
              attemptId: input.attemptId,
              gatewayTradeNo: input.gatewayTradeNo,
            },
          },
          snapshot,
          idempotencyKey,
        );
      }
      return await this.createOfferCheckout(
        tx,
        input.userId,
        { offerId: input.offerId },
        idempotencyKey,
        {
          externalPayment: {
            attemptId: input.attemptId,
            gatewayTradeNo: input.gatewayTradeNo,
            amountCents: input.amountCents,
            basePriceCents: input.basePriceCents,
            entitlementSnapshot: input.entitlementSnapshot,
            paidAt: input.paidAt,
            entitlementStartsAt: input.entitlementStartsAt,
          },
        },
      );
    } catch (error) {
      if (error instanceof PaymentFulfillmentRejectedError) throw error;
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw new PaymentFulfillmentRejectedError(
          'ENTITLEMENT_NO_LONGER_AVAILABLE',
          error.message,
        );
      }
      throw error;
    }
  }

  async fulfillGroupBuyWalletPayment(
    tx: Prisma.TransactionClient,
    input: GroupBuyWalletSettlementInput,
  ) {
    const idempotencyKey = `group-buy-wallet:${input.memberId}`;
    const existing = await tx.manualOrder.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: input.userId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      return this.replayCheckout(existing, { offerId: input.offerId });
    }
    return this.createOfferCheckout(
      tx,
      input.userId,
      { offerId: input.offerId },
      idempotencyKey,
      {
        walletPayment: {
          amountCents: input.amountCents,
          basePriceCents: input.basePriceCents,
          entitlementSnapshot: input.entitlementSnapshot,
          paidAt: input.paidAt,
        },
      },
    );
  }

  private replayCheckout(
    existing: {
      id: string;
      planId: string | null;
      planOfferId: string | null;
      trafficPackProductId: string | null;
      catalogOfferId?: string | null;
    },
    input: CheckoutInput,
  ): CheckoutResult {
    const sameProduct =
      'offerId' in input
        ? existing.catalogOfferId === input.offerId
        : input.kind === 'plan'
          ? existing.planId === input.productId
          : input.kind === 'plan_offer'
            ? existing.planOfferId === input.productId
            : existing.trafficPackProductId === input.productId;
    if (!sameProduct) {
      throw new ConflictException(
        'Idempotency-Key was already used for another product',
      );
    }
    return {
      orderId: existing.id,
      replayed: true,
      kind: 'kind' in input ? input.kind : undefined,
    };
  }

  private isRetryableTransactionError(error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error)) return false;
    return error.code === 'P2034' || error.code === 'P2002';
  }

  private async createCheckout(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CheckoutInput,
    idempotencyKey: string,
  ): Promise<CheckoutResult> {
    if ('offerId' in input) {
      if (input.purchaseAction === 'plan_reset') {
        return this.createWalletPlanReset(tx, userId, input, idempotencyKey);
      }
      return this.createOfferCheckout(tx, userId, input, idempotencyKey);
    }
    if (input.kind === 'plan' || input.kind === 'plan_offer') {
      return this.createPlanCheckout(tx, userId, input, idempotencyKey);
    }

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Account is not active');
    }

    const product = await tx.trafficPackProduct.findUnique({
      where: { id: input.productId },
      include: {
        accessProfile: {
          include: {
            nodeBindings: { where: { node: { active: true } }, take: 1 },
          },
        },
      },
    });
    if (!product || product.archivedAt) {
      throw new NotFoundException('Traffic pack product not found');
    }
    if (!product.active) {
      throw new BadRequestException('Traffic pack product is inactive');
    }
    if (
      !product.accessProfile ||
      !product.accessProfile.active ||
      product.accessProfile.nodeBindings.length === 0
    ) {
      throw new BadRequestException(
        'Traffic pack requires an active access profile',
      );
    }

    const purchasedAt = new Date();
    const subscription = await tx.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: purchasedAt },
        endsAt: { gt: purchasedAt },
      },
      orderBy: { endsAt: 'desc' },
    });

    const discount = input.discountCode
      ? await this.reserveDiscount(
          tx,
          userId,
          input.discountCode,
          product.priceCents,
        )
      : null;
    const chargedCents = Math.max(
      product.priceCents - (discount?.discountCents ?? 0),
      0,
    );

    const expiresAt = product.validityDays
      ? this.addDays(purchasedAt, product.validityDays)
      : null;
    const entitlementExpiresAt = expiresAt ?? permanentEntitlementEnd();
    const account = await tx.accessAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const order = await tx.manualOrder.create({
      data: {
        userId,
        trafficPackProductId: product.id,
        status: OrderStatus.APPLIED,
        kind: OrderKind.TRAFFIC_PACK,
        source: OrderSource.WALLET,
        amountCents: chargedCents,
        basePriceCents: product.priceCents,
        discountCents: discount?.discountCents ?? 0,
        currency: 'CNY',
        productSlugSnapshot: product.slug,
        productNameSnapshot: product.name,
        trafficBytes: product.trafficBytes,
        validityDays: product.validityDays,
        entitlementExpiresAt,
        accessProfileIdSnapshot: product.accessProfileId,
        idempotencyKey,
        processedAt: purchasedAt,
      },
    });
    await postWalletEntry(tx, {
      userId,
      orderId: order.id,
      amountCents: -chargedCents,
      kind: 'PURCHASE',
      idempotencyKey,
      note: `购买流量包 ${product.name}`,
    });

    if (discount) {
      await tx.redemptionUse.create({
        data: {
          codeId: discount.codeId,
          userId,
          orderId: order.id,
        },
      });
    }

    const trafficPack = await tx.trafficPack.create({
      data: {
        userId,
        subscriptionId: subscription?.id ?? null,
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

    await tx.paymentRecord.create({
      data: {
        orderId: order.id,
        userId,
        source: 'WALLET',
        status: 'SETTLED',
        amountCents: chargedCents,
        currency: 'CNY',
        paidAt: purchasedAt,
        reconciledAt: purchasedAt,
      },
    });
    if (this.entitlements && order.catalogOfferId) {
      await this.entitlements.grantFromOrder(
        { orderId: order.id, trafficPackId: trafficPack.id },
        tx,
      );
    }

    return {
      orderId: order.id,
      replayed: false,
      kind: input.kind,
      productName: product.name,
      chargedCents,
      entitlementExpiresAt: expiresAt?.toISOString(),
    };
  }

  private async createOfferCheckout(
    tx: Prisma.TransactionClient,
    userId: string,
    input: Extract<CheckoutInput, { offerId: string }>,
    idempotencyKey: string,
    options: {
      complimentary?: boolean;
      complimentaryKind?: CatalogProductKind;
      complimentaryAuditAction?: string;
      actorId?: string;
      externalPayment?: {
        attemptId: string;
        gatewayTradeNo: string;
        amountCents: number;
        basePriceCents: number;
        entitlementSnapshot: Prisma.JsonValue | null;
        paidAt: Date;
        entitlementStartsAt?: Date;
      };
      walletPayment?: {
        amountCents: number;
        basePriceCents: number;
        entitlementSnapshot: Prisma.JsonValue;
        paidAt: Date;
      };
    } = {},
  ): Promise<CheckoutResult> {
    const settledPayment =
      options.externalPayment ?? options.walletPayment ?? null;
    if (options.complimentary && settledPayment) {
      throw new BadRequestException('Checkout payment source is ambiguous');
    }
    const [user, offer] = await Promise.all([
      tx.user.findUnique({ where: { id: userId } }),
      tx.catalogOffer.findUnique({
        where: { id: input.offerId },
        include: {
          legacyPlanOffer: true,
          product: {
            include: { accessProfile: true, legacyPlan: true },
          },
        },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Account is not active');
    }
    if (!offer || (offer.archivedAt && !settledPayment)) {
      throw new NotFoundException('Catalog offer not found');
    }
    const snapshot = settledPayment
      ? parseCatalogOfferSnapshot(settledPayment.entitlementSnapshot)
      : null;
    if (
      snapshot &&
      (snapshot.offerId !== offer.id || snapshot.productId !== offer.product.id)
    ) {
      throw new ConflictException('External payment snapshot does not match');
    }
    const productKind = snapshot?.productKind ?? offer.product.kind;
    const productSeries = snapshot?.productSeries ?? offer.product.series;
    const quotaCadence = snapshot?.quotaCadence ?? offer.product.quotaCadence;
    const billingPeriod = snapshot?.billingPeriod ?? offer.billingPeriod;
    const intervalMonths = snapshot?.intervalMonths ?? offer.intervalMonths;
    const legacyDurationDays = snapshot
      ? snapshot.legacyDurationDays
      : offer.billingPeriod === BillingPeriod.LEGACY
        ? (offer.legacyPlanOffer?.legacyDurationDays ??
          offer.product.legacyPlan?.durationDays ??
          null)
        : null;
    const trafficBytes = snapshot
      ? BigInt(snapshot.trafficBytes)
      : offer.trafficBytes;
    const currency = snapshot?.currency ?? offer.currency;
    const accessProfileId =
      snapshot?.accessProfileId ?? offer.product.accessProfileId;
    const accessProfile = snapshot
      ? await tx.accessProfile.findUnique({
          where: { id: snapshot.accessProfileId },
        })
      : offer.product.accessProfile;
    const speedUpMbps = snapshot?.speedUpMbps ?? accessProfile?.speedUpMbps;
    const speedDownMbps =
      snapshot?.speedDownMbps ?? accessProfile?.speedDownMbps;
    const deviceLimit = snapshot?.deviceLimit ?? accessProfile?.deviceLimit;
    const requiresActivePlan =
      snapshot?.requiresActivePlan ?? offer.product.requiresActivePlan;
    const legacyPlanId = snapshot?.legacyPlanId ?? offer.product.legacyPlanId;
    const legacyPlanOfferId =
      snapshot?.legacyPlanOfferId ?? offer.legacyPlanOfferId;
    const legacyTrafficPackProductId =
      snapshot?.legacyTrafficPackProductId ??
      offer.product.legacyTrafficPackProductId;
    const hasValidDuration =
      isPermanentBillingPeriod(billingPeriod) ||
      (billingPeriod === BillingPeriod.LEGACY
        ? Boolean(legacyDurationDays && legacyDurationDays > 0)
        : Boolean(intervalMonths && intervalMonths > 0));
    if (
      (!settledPayment &&
        (!offer.active ||
          offer.product.status !== CatalogProductStatus.ACTIVE ||
          !offer.product.accessProfile?.active)) ||
      !accessProfileId ||
      !accessProfile ||
      speedUpMbps === undefined ||
      speedDownMbps === undefined ||
      deviceLimit === undefined ||
      !hasValidDuration
    ) {
      throw new BadRequestException('Catalog offer is not purchasable');
    }
    if (
      options.complimentaryKind &&
      productKind !== options.complimentaryKind
    ) {
      throw new BadRequestException(
        'Complimentary grant does not match the configured product kind',
      );
    }
    if (!options.complimentary) {
      if (settledPayment && productSeries !== CatalogProductSeries.ULTRA) {
        await assertCatalogPurchaseLimit(tx, userId, {
          kind: productKind,
          purchaseLimitPerUser:
            snapshot?.purchaseLimitPerUser ??
            offer.product.purchaseLimitPerUser,
          purchaseLimitKey:
            snapshot?.purchaseLimitKey ?? offer.product.purchaseLimitKey,
          requiresActivePlan,
        });
      } else if (productSeries !== CatalogProductSeries.ULTRA) {
        await assertCatalogPurchaseEligibility(tx, userId, offer.product);
      }
    }
    const nodeId = await this.resolveServiceableNodeId(tx, accessProfileId);
    if (!nodeId) {
      throw new BadRequestException('Catalog offer has no serviceable node');
    }
    const ultraPurchase =
      productSeries === CatalogProductSeries.ULTRA
        ? await this.resolveUltraPurchase(tx, userId, {
            id: offer.product.id,
            name: snapshot?.productName ?? offer.product.name,
            priceCents: settledPayment?.basePriceCents ?? offer.priceCents,
            trafficBytes,
          })
        : null;
    if (
      snapshot &&
      ultraPurchase &&
      (snapshot.purchaseMode !== ultraPurchase.mode ||
        snapshot.upgradeFromGrantId !== ultraPurchase.grantId ||
        snapshot.upgradeFromProductId !== ultraPurchase.productId ||
        snapshot.upgradeFromPriceCents !== ultraPurchase.priceCents)
    ) {
      throw new ConflictException('Ultra purchase state changed');
    }
    const payableBeforeDiscountCents =
      ultraPurchase?.payableCents ?? offer.priceCents;
    const discount =
      !options.complimentary && !settledPayment && input.discountCode
        ? await this.reserveDiscount(
            tx,
            userId,
            input.discountCode,
            payableBeforeDiscountCents,
          )
        : null;
    const chargedCents = options.complimentary
      ? 0
      : settledPayment
        ? settledPayment.amountCents
        : Math.max(
            payableBeforeDiscountCents - (discount?.discountCents ?? 0),
            0,
          );
    const basePriceCents = settledPayment?.basePriceCents ?? offer.priceCents;
    const groupBuyPayment =
      Boolean(settledPayment) && snapshot?.purchaseMode === 'group_buy';
    const expectedSettledPaymentCents = groupBuyPayment
      ? snapshot?.groupBuySettlementMode === 'ORIGINAL_PRICE_BALANCE_REBATE'
        ? snapshot.groupBuyOriginalPriceCents
        : snapshot?.groupBuyPriceCents
      : payableBeforeDiscountCents;
    if (
      chargedCents < 0 ||
      chargedCents > basePriceCents ||
      (settledPayment && chargedCents !== expectedSettledPaymentCents) ||
      (groupBuyPayment &&
        basePriceCents !== snapshot?.groupBuyOriginalPriceCents)
    ) {
      throw new BadRequestException('External payment amount is invalid');
    }
    const purchasedAt =
      options.externalPayment?.entitlementStartsAt ??
      settledPayment?.paidAt ??
      new Date();
    let standardPlanPurchase: PlanPurchasePolicy | null = null;
    if (
      productKind === CatalogProductKind.PLAN &&
      productSeries === CatalogProductSeries.STANDARD &&
      legacyPlanId
    ) {
      if (snapshot?.planActivationMode && snapshot.planEffectiveAt) {
        const quotedEffectiveAt = new Date(snapshot.planEffectiveAt);
        standardPlanPurchase = {
          mode: snapshot.planActivationMode,
          effectiveAt:
            snapshot.planActivationMode === 'scheduled_switch' &&
            quotedEffectiveAt > purchasedAt
              ? quotedEffectiveAt
              : purchasedAt,
          currentPlan: null,
          forfeitedDays: 0,
        };
      } else {
        standardPlanPurchase = await this.resolveStandardPlanPurchasePolicy(
          tx,
          userId,
          {
            productId: offer.product.id,
            productName: snapshot?.productName ?? offer.product.name,
            legacyPlanId,
          },
          input.planActivation,
          {
            forceImmediate: Boolean(settledPayment) || options.complimentary,
            skipPendingGuard: Boolean(settledPayment) || options.complimentary,
          },
          purchasedAt,
        );
      }
      if (!settledPayment && !options.complimentary) {
        const pendingPayment = await tx.epayPaymentAttempt.findUnique({
          where: { activeKey: standardPlanPurchaseKey(userId) },
          select: { id: true },
        });
        if (pendingPayment) {
          throw new ConflictException('已有待支付的套餐订单，请先完成或关闭');
        }
      }
    }
    const expiryOffer = {
      billingPeriod,
      intervalMonths,
      legacyDurationDays,
    };
    const entitlementExpiresAt = this.offerExpiry(purchasedAt, expiryOffer);
    const trafficPackExpiresAt = isPermanentBillingPeriod(billingPeriod)
      ? null
      : entitlementExpiresAt;
    const account = await tx.accessAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    let subscriptionId: string | undefined;
    let trafficPackId: string | undefined;
    let entitlementStartsAt = purchasedAt;
    const activePlanSubscription = requiresActivePlan
      ? await tx.subscription.findFirst({
          where: {
            userId,
            status: SubscriptionStatus.ACTIVE,
            startsAt: { lte: purchasedAt },
            endsAt: { gt: purchasedAt },
          },
          orderBy: { endsAt: 'desc' },
        })
      : null;

    if (productKind === CatalogProductKind.PLAN) {
      if (!legacyPlanId) {
        throw new BadRequestException('Plan compatibility mapping is missing');
      }
      const existing = await tx.subscription.findFirst({
        where: {
          userId,
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
          },
          startsAt: { lte: purchasedAt },
          endsAt: { gt: purchasedAt },
        },
        orderBy: [{ endsAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (
        existing &&
        existing.planId === legacyPlanId &&
        !options.complimentary
      ) {
        const extendsCurrentTerm = existing.endsAt > purchasedAt;
        const extensionBase = extendsCurrentTerm
          ? existing.endsAt
          : purchasedAt;
        const extendedEndsAt = this.offerExpiry(
          extensionBase,
          expiryOffer,
          extendsCurrentTerm ? existing.startsAt : purchasedAt,
        );
        const updated = await tx.subscription.update({
          where: { id: existing.id },
          data: {
            nodeId,
            accessAccountId: account.id,
            planOfferId: legacyPlanOfferId,
            status: SubscriptionStatus.ACTIVE,
            startsAt: extendsCurrentTerm ? undefined : purchasedAt,
            endsAt: extendedEndsAt,
            includedTrafficBytes: trafficBytes,
            bonusTrafficBytes: extendsCurrentTerm ? undefined : BigInt(0),
            consumedTrafficBytes: extendsCurrentTerm ? undefined : BigInt(0),
            speedUpMbpsSnapshot: speedUpMbps,
            speedDownMbpsSnapshot: speedDownMbps,
            deviceLimitSnapshot: deviceLimit,
          },
        });
        subscriptionId = updated.id;
      } else {
        const activationMode =
          standardPlanPurchase?.mode ??
          (existing ? 'immediate_switch' : 'initial');
        const scheduledSwitch =
          activationMode === 'scheduled_switch' && Boolean(existing);
        entitlementStartsAt = scheduledSwitch
          ? standardPlanPurchase!.effectiveAt
          : purchasedAt;
        if (existing && !scheduledSwitch) {
          await tx.subscription.updateMany({
            where: {
              userId,
              status: {
                in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
              },
              startsAt: { lte: purchasedAt },
            },
            data: { status: SubscriptionStatus.CANCELED, endsAt: purchasedAt },
          });
          await tx.subscription.updateMany({
            where: {
              userId,
              status: {
                in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
              },
              startsAt: { gt: purchasedAt },
            },
            data: { status: SubscriptionStatus.CANCELED },
          });
        }
        const planEntitlementExpiresAt = this.offerExpiry(
          entitlementStartsAt,
          expiryOffer,
        );
        const subscription = await tx.subscription.create({
          data: {
            userId,
            planId: legacyPlanId,
            nodeId,
            accessAccountId: account.id,
            planOfferId: legacyPlanOfferId,
            status: SubscriptionStatus.ACTIVE,
            startsAt: entitlementStartsAt,
            endsAt: planEntitlementExpiresAt,
            includedTrafficBytes: trafficBytes,
            speedUpMbpsSnapshot: speedUpMbps,
            speedDownMbpsSnapshot: speedDownMbps,
            deviceLimitSnapshot: deviceLimit,
            cycles: {
              create: {
                startsAt: entitlementStartsAt,
                endsAt: this.firstCycleEnd(
                  entitlementStartsAt,
                  planEntitlementExpiresAt,
                ),
                grantedBytes: trafficBytes,
              },
            },
          },
        });
        subscriptionId = subscription.id;
      }
    } else if (productSeries !== CatalogProductSeries.ULTRA) {
      const pack = await tx.trafficPack.create({
        data: {
          userId,
          subscriptionId: activePlanSubscription?.id ?? null,
          accessAccountId: account.id,
          trafficPackProductId: legacyTrafficPackProductId,
          accessProfileId,
          label: `${snapshot?.productName ?? offer.product.name} · ${snapshot?.offerName ?? offer.name}`,
          totalBytes: trafficBytes,
          remainingBytes: trafficBytes,
          status: TrafficPackStatus.ACTIVE,
          expiresAt: trafficPackExpiresAt,
        },
      });
      trafficPackId = pack.id;
    }

    const order = await tx.manualOrder.create({
      data: {
        userId,
        planId: productKind === CatalogProductKind.PLAN ? legacyPlanId : null,
        planOfferId: legacyPlanOfferId,
        trafficPackProductId:
          productKind === CatalogProductKind.TRAFFIC_PACK
            ? legacyTrafficPackProductId
            : null,
        catalogOfferId: offer.id,
        status: OrderStatus.APPLIED,
        kind:
          productKind === CatalogProductKind.PLAN
            ? OrderKind.RENEWAL
            : OrderKind.TRAFFIC_PACK,
        source: options.complimentary
          ? OrderSource.ADMIN
          : options.externalPayment
            ? OrderSource.PAYMENT
            : OrderSource.WALLET,
        amountCents: chargedCents,
        basePriceCents,
        discountCents: options.complimentary
          ? basePriceCents
          : options.externalPayment
            ? ultraPurchase?.mode === 'upgrade'
              ? 0
              : basePriceCents - chargedCents
            : (discount?.discountCents ?? 0),
        currency,
        productSlugSnapshot: snapshot?.offerSlug ?? offer.slug,
        productNameSnapshot: `${snapshot?.productName ?? offer.product.name} · ${snapshot?.offerName ?? offer.name}`,
        validityDays:
          productKind === CatalogProductKind.TRAFFIC_PACK
            ? isPermanentBillingPeriod(billingPeriod)
              ? null
              : Math.round(
                  (entitlementExpiresAt.getTime() - purchasedAt.getTime()) /
                    (24 * 60 * 60 * 1000),
                )
            : null,
        trafficBytes,
        entitlementExpiresAt:
          productKind === CatalogProductKind.PLAN && subscriptionId
            ? (
                await tx.subscription.findUniqueOrThrow({
                  where: { id: subscriptionId },
                  select: { endsAt: true },
                })
              ).endsAt
            : entitlementExpiresAt,
        billingPeriodSnapshot: billingPeriod,
        intervalMonthsSnapshot: intervalMonths,
        accessProfileIdSnapshot: accessProfileId,
        speedUpMbpsSnapshot: speedUpMbps,
        speedDownMbpsSnapshot: speedDownMbps,
        deviceLimitSnapshot: deviceLimit,
        trafficMultiplierBasisPointsSnapshot:
          snapshot?.trafficMultiplierBasisPoints ??
          offer.product.defaultTrafficMultiplierBasisPoints,
        requiresActivePlanSnapshot: requiresActivePlan,
        quotaCadenceSnapshot: quotaCadence,
        resetAnchorAtSnapshot:
          ultraPurchase?.resetAnchorAt ?? entitlementStartsAt,
        upgradeFromProductIdSnapshot: ultraPurchase?.productId,
        upgradeFromPriceCentsSnapshot: ultraPurchase?.priceCents,
        idempotencyKey,
        processedAt: purchasedAt,
      },
    });
    if (!options.complimentary && !options.externalPayment) {
      await postWalletEntry(tx, {
        userId,
        orderId: order.id,
        amountCents: -chargedCents,
        kind: 'PURCHASE',
        idempotencyKey,
        note: `购买 ${offer.product.name} · ${offer.name}`,
      });
    }
    if (discount) {
      await tx.redemptionUse.create({
        data: { codeId: discount.codeId, userId, orderId: order.id },
      });
    }
    if (options.externalPayment) {
      await Promise.all([
        tx.paymentRecord.create({
          data: {
            orderId: order.id,
            userId,
            source: 'EPAY',
            status: 'SETTLED',
            amountCents: chargedCents,
            currency,
            externalRef: options.externalPayment.gatewayTradeNo,
            paidAt: options.externalPayment.paidAt,
            reconciledAt: purchasedAt,
          },
        }),
        tx.auditLog.create({
          data: {
            action: 'EPAY_PAYMENT_SETTLED',
            targetType: 'ManualOrder',
            targetId: order.id,
            metadata: {
              userId,
              offerId: offer.id,
              attemptId: options.externalPayment.attemptId,
              gatewayTradeNo: options.externalPayment.gatewayTradeNo,
              paidCents: chargedCents,
            },
          },
        }),
      ]);
    } else if (!options.complimentary) {
      await tx.paymentRecord.create({
        data: {
          orderId: order.id,
          userId,
          source: 'WALLET',
          status: 'SETTLED',
          amountCents: chargedCents,
          currency: offer.currency,
          paidAt: purchasedAt,
          reconciledAt: purchasedAt,
        },
      });
    } else {
      await tx.auditLog.create({
        data: {
          actorId: options.actorId,
          action:
            options.complimentaryAuditAction ??
            'COMPLIMENTARY_ENTITLEMENT_GRANTED',
          targetType: 'ManualOrder',
          targetId: order.id,
          metadata: {
            userId,
            offerId: offer.id,
            productKind,
            listPriceCents: offer.priceCents,
            recognizedRevenueCents: 0,
          },
        },
      });
    }
    if (!this.entitlements) {
      throw new ConflictException('Entitlement module is unavailable');
    }
    const grant = await this.entitlements.grantFromOrder(
      {
        orderId: order.id,
        subscriptionId,
        trafficPackId,
        ...(standardPlanPurchase?.mode === 'scheduled_switch'
          ? { startsAt: entitlementStartsAt, preserveExistingPlan: true }
          : {}),
      },
      tx,
    );
    if (
      productKind === CatalogProductKind.PLAN &&
      options.externalPayment &&
      this.referrals
    ) {
      await this.referrals.settlePlanPurchaseReward(
        tx,
        userId,
        order.id,
        grant.id,
      );
    }
    return {
      orderId: order.id,
      replayed: false,
      kind:
        offer.product.kind === CatalogProductKind.PLAN
          ? 'plan_offer'
          : 'traffic_pack',
      productName: `${offer.product.name} · ${offer.name}`,
      chargedCents,
      entitlementExpiresAt: order.entitlementExpiresAt?.toISOString(),
    };
  }

  private async resolveServiceableNodeId(
    tx: Prisma.TransactionClient,
    accessProfileId: string,
  ) {
    const binding = await tx.accessProfileNode.findFirst({
      where: {
        accessProfileId,
        node: { active: true, lifecycleStatus: 'ACTIVE' },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return binding?.nodeId ?? null;
  }

  private async resolveStandardPlanPurchasePolicy(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
    target: {
      productId: string;
      productName: string;
      legacyPlanId: string;
    },
    preference?: PlanActivationPreference,
    options: { forceImmediate?: boolean; skipPendingGuard?: boolean } = {},
    now = new Date(),
  ): Promise<PlanPurchasePolicy> {
    const [current, scheduled, activeGroup] = await Promise.all([
      client.subscription.findFirst({
        where: {
          userId,
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
          },
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        include: {
          plan: { include: { catalogProduct: true } },
        },
        orderBy: [{ endsAt: 'desc' }, { createdAt: 'desc' }],
      }),
      options.skipPendingGuard
        ? Promise.resolve(null)
        : client.subscription.findFirst({
            where: {
              userId,
              status: {
                in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
              },
              startsAt: { gt: now },
              endsAt: { gt: now },
            },
            select: { id: true },
          }),
      options.skipPendingGuard
        ? Promise.resolve(null)
        : client.groupBuyMember.findFirst({
            where: {
              userId,
              activeSlot: { not: null },
              status: {
                in: [
                  GroupBuyMemberStatus.PAYMENT_PENDING,
                  GroupBuyMemberStatus.PAID,
                  GroupBuyMemberStatus.FULFILLED,
                ],
              },
            },
            select: { id: true },
          }),
    ]);
    if (scheduled) {
      throw new ConflictException(
        '已有预约生效的套餐，当前仅可重置本期流量，请等待切换后再续费、换套餐或参加拼团',
      );
    }
    if (activeGroup) {
      throw new ConflictException('已有进行中的套餐拼团，请先完成当前拼团');
    }
    return decidePlanPurchasePolicy({
      now,
      targetProductId: target.productId,
      targetLegacyPlanId: target.legacyPlanId,
      preference,
      forceImmediate: options.forceImmediate,
      currentPlan: current
        ? {
            productId: current.plan.catalogProduct?.id ?? null,
            productName: current.plan.catalogProduct?.name ?? current.plan.name,
            legacyPlanId: current.planId,
            startsAt: current.startsAt,
            endsAt: current.endsAt,
          }
        : null,
    });
  }

  private async resolvePlanReset(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
    offerId: string,
    now = new Date(),
  ) {
    const offer = await client.catalogOffer.findUnique({
      where: { id: offerId },
      include: catalogOfferSnapshotInclude,
    });
    if (
      !offer ||
      offer.archivedAt ||
      !offer.active ||
      offer.billingPeriod !== BillingPeriod.MONTHLY ||
      offer.product.kind !== CatalogProductKind.PLAN ||
      offer.product.series !== CatalogProductSeries.STANDARD
    ) {
      throw new BadRequestException('请选择当前套餐的月付规格重置流量');
    }
    const grant = await client.entitlementGrant.findFirst({
      where: {
        userId,
        productId: offer.productId,
        kind: 'PLAN',
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      include: {
        quotaBuckets: {
          where: { startsAt: { lte: now }, endsAt: { gt: now } },
          orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    });
    const bucket = grant?.quotaBuckets[0];
    if (!grant || !bucket) {
      throw new BadRequestException('当前没有可重置的有效套餐周期');
    }
    const targetBytes = grant.trafficBytesSnapshot ?? offer.trafficBytes;
    const currentRemainingBytes =
      bucket.grantedBytes > bucket.consumedBytes
        ? bucket.grantedBytes - bucket.consumedBytes
        : BigInt(0);
    if (targetBytes <= BigInt(0)) {
      throw new BadRequestException('当前套餐流量额度无效');
    }
    const payableCents = Math.round(
      (offer.priceCents * PLAN_RESET_PRICE_PERCENT) / 100,
    );
    if (payableCents <= 0) {
      throw new BadRequestException('本期流量重置价格无效');
    }
    return {
      offer,
      grantId: grant.id,
      bucketId: bucket.id,
      cycleStartsAt: bucket.startsAt,
      cycleEndsAt: bucket.endsAt,
      targetBytes,
      currentRemainingBytes,
      creditBytes: targetBytes,
      payableCents,
    };
  }

  private async fulfillPlanReset(
    tx: Prisma.TransactionClient,
    input: PlanResetSettlementInput,
    snapshot: CatalogOfferSnapshot,
    idempotencyKey: string,
  ): Promise<CheckoutResult> {
    if (
      snapshot.productKind !== CatalogProductKind.PLAN ||
      snapshot.productSeries === CatalogProductSeries.ULTRA ||
      snapshot.billingPeriod !== BillingPeriod.MONTHLY ||
      !snapshot.resetGrantId ||
      !snapshot.resetBucketId ||
      !snapshot.resetCycleStartsAt ||
      !snapshot.resetCycleEndsAt ||
      !snapshot.resetTrafficBytes
    ) {
      throw new ConflictException('本期流量重置快照不完整');
    }
    const expectedAmountCents = Math.round(
      (input.basePriceCents * PLAN_RESET_PRICE_PERCENT) / 100,
    );
    if (
      snapshot.offerId !== input.offerId ||
      input.amountCents !== expectedAmountCents ||
      input.amountCents <= 0
    ) {
      throw new ConflictException('本期流量重置支付金额不匹配');
    }
    const [grant, quotedBucket] = await Promise.all([
      tx.entitlementGrant.findFirst({
        where: {
          id: snapshot.resetGrantId,
          userId: input.userId,
          productId: snapshot.productId,
          kind: 'PLAN',
          status: 'ACTIVE',
          startsAt: { lte: input.paidAt },
          endsAt: { gt: input.paidAt },
        },
      }),
      tx.quotaBucket.findUnique({ where: { id: snapshot.resetBucketId } }),
    ]);
    if (!grant || !quotedBucket || quotedBucket.grantId !== grant.id) {
      throw new ConflictException('流量重置关联的套餐权益已经失效');
    }
    const quotedCycleMatches =
      quotedBucket.startsAt.toISOString() === snapshot.resetCycleStartsAt &&
      quotedBucket.endsAt.toISOString() === snapshot.resetCycleEndsAt;
    if (!quotedCycleMatches) {
      throw new ConflictException('流量重置订单快照与原套餐周期不匹配');
    }
    const quotedCycleIsCurrent =
      quotedBucket.startsAt <= input.paidAt &&
      quotedBucket.endsAt > input.paidAt;
    if (!quotedCycleIsCurrent) {
      throw new PaymentFulfillmentRejectedError(
        'PLAN_RESET_CYCLE_ENDED',
        '流量重置订单已超过原套餐周期',
      );
    }
    const bucket = quotedBucket;
    const targetBytes = BigInt(snapshot.resetTrafficBytes);
    const beforeRemainingBytes =
      bucket.grantedBytes > bucket.consumedBytes
        ? bucket.grantedBytes - bucket.consumedBytes
        : BigInt(0);
    if (targetBytes <= BigInt(0)) {
      throw new ConflictException('流量重置额度无效');
    }
    const creditBytes = snapshot.resetCreditBytes
      ? BigInt(snapshot.resetCreditBytes)
      : beforeRemainingBytes < targetBytes
        ? targetBytes - beforeRemainingBytes
        : targetBytes;
    if (creditBytes <= BigInt(0)) {
      throw new ConflictException('流量重置承诺额度无效');
    }
    const order = await tx.manualOrder.create({
      data: {
        userId: input.userId,
        planId: snapshot.legacyPlanId,
        planOfferId: snapshot.legacyPlanOfferId,
        catalogOfferId: snapshot.offerId,
        status: OrderStatus.APPLIED,
        kind: OrderKind.RENEWAL,
        source: input.epay ? OrderSource.PAYMENT : OrderSource.WALLET,
        amountCents: input.amountCents,
        basePriceCents: input.basePriceCents,
        discountCents: input.basePriceCents - input.amountCents,
        currency: snapshot.currency,
        productSlugSnapshot: snapshot.offerSlug,
        productNameSnapshot: `${snapshot.productName} · 本期流量重置`,
        trafficBytes: creditBytes,
        entitlementExpiresAt: bucket.endsAt,
        billingPeriodSnapshot: BillingPeriod.MONTHLY,
        intervalMonthsSnapshot: 1,
        accessProfileIdSnapshot: grant.accessProfileId,
        speedUpMbpsSnapshot: grant.speedUpMbpsSnapshot,
        speedDownMbpsSnapshot: grant.speedDownMbpsSnapshot,
        deviceLimitSnapshot: grant.deviceLimitSnapshot,
        trafficMultiplierBasisPointsSnapshot:
          grant.trafficMultiplierBasisPointsSnapshot,
        requiresActivePlanSnapshot: false,
        quotaCadenceSnapshot: QuotaCadence.MONTHLY_RESET,
        resetAnchorAtSnapshot: bucket.startsAt,
        entitlementGrantId: grant.id,
        idempotencyKey,
        note: PLAN_RESET_ORDER_NOTE,
        processedAt: input.paidAt,
      },
    });
    if (!this.entitlements) {
      throw new ConflictException('Entitlement module is unavailable');
    }
    if (!input.epay) {
      await postWalletEntry(tx, {
        userId: input.userId,
        orderId: order.id,
        amountCents: -input.amountCents,
        kind: 'PURCHASE',
        idempotencyKey,
        note: `购买 ${snapshot.productName} · 本期流量重置`,
      });
    }
    await this.entitlements.creditQuotaBucket(tx, {
      bucketId: bucket.id,
      bytes: creditBytes,
      at: input.paidAt,
      idempotencyKey: `plan-reset:${order.id}`,
      reason: '用户购买本期流量重置',
    });
    await tx.paymentRecord.create({
      data: {
        orderId: order.id,
        userId: input.userId,
        source: input.epay ? 'EPAY' : 'WALLET',
        status: 'SETTLED',
        amountCents: input.amountCents,
        currency: snapshot.currency,
        externalRef: input.epay?.gatewayTradeNo,
        paidAt: input.paidAt,
        reconciledAt: input.paidAt,
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'PLAN_QUOTA_RESET_SETTLED',
        targetType: 'ManualOrder',
        targetId: order.id,
        metadata: {
          userId: input.userId,
          offerId: snapshot.offerId,
          paymentSource: input.epay ? 'EPAY' : 'WALLET',
          attemptId: input.epay?.attemptId,
          gatewayTradeNo: input.epay?.gatewayTradeNo,
          paidCents: input.amountCents,
          creditedBytes: creditBytes.toString(),
          cycleEndsAt: bucket.endsAt.toISOString(),
        },
      },
    });
    return {
      orderId: order.id,
      replayed: false,
      kind: 'plan_offer',
      productName: `${snapshot.productName} · 本期流量重置`,
      chargedCents: input.amountCents,
      entitlementExpiresAt: bucket.endsAt.toISOString(),
    };
  }

  private async createWalletPlanReset(
    tx: Prisma.TransactionClient,
    userId: string,
    input: Extract<CheckoutInput, { offerId: string }>,
    idempotencyKey: string,
  ) {
    const now = new Date();
    const reset = await this.resolvePlanReset(tx, userId, input.offerId, now);
    const snapshot = snapshotCatalogOffer(reset.offer, {
      purchaseMode: 'plan_reset',
      resetGrantId: reset.grantId,
      resetBucketId: reset.bucketId,
      resetCycleStartsAt: reset.cycleStartsAt.toISOString(),
      resetCycleEndsAt: reset.cycleEndsAt.toISOString(),
      resetTrafficBytes: reset.targetBytes.toString(),
      resetCreditBytes: reset.creditBytes.toString(),
    });
    return this.fulfillPlanReset(
      tx,
      {
        userId,
        offerId: input.offerId,
        amountCents: reset.payableCents,
        basePriceCents: reset.offer.priceCents,
        paidAt: now,
      },
      snapshot,
      idempotencyKey,
    );
  }

  private async createPlanCheckout(
    tx: Prisma.TransactionClient,
    userId: string,
    input: Extract<CheckoutInput, { kind: 'plan' | 'plan_offer' }>,
    idempotencyKey: string,
  ): Promise<CheckoutResult> {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Account is not active');
    }
    const resolved = await this.resolvePlanOffer(tx, input);
    const { plan, offer } = resolved;
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.active) throw new BadRequestException('Plan is inactive');

    const bindings = plan.accessProfileId
      ? await tx.accessProfileNode.findMany({
          where: {
            accessProfileId: plan.accessProfileId,
            node: { active: true },
          },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        })
      : await tx.planBinding.findMany({
          where: { planId: plan.id, node: { active: true } },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        });
    const nodeId = bindings[0]?.nodeId;
    if (!nodeId) {
      throw new BadRequestException('Plan has no active node binding');
    }

    const discount = input.discountCode
      ? await this.reserveDiscount(
          tx,
          userId,
          input.discountCode,
          offer.priceCents,
        )
      : null;
    const chargedCents = Math.max(
      offer.priceCents - (discount?.discountCents ?? 0),
      0,
    );
    const purchasedAt = new Date();
    const account = await tx.accessAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const existing = await tx.subscription.findFirst({
      where: {
        userId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
        },
      },
      orderBy: { endsAt: 'desc' },
    });
    let entitlementExpiresAt: Date;
    if (!existing) {
      entitlementExpiresAt = this.offerExpiry(purchasedAt, offer);
      await tx.subscription.create({
        data: {
          userId,
          planId: plan.id,
          nodeId,
          accessAccountId: account.id,
          planOfferId: offer.id,
          status: SubscriptionStatus.ACTIVE,
          startsAt: purchasedAt,
          endsAt: entitlementExpiresAt,
          includedTrafficBytes: plan.trafficBytes,
          bonusTrafficBytes: BigInt(0),
          consumedTrafficBytes: BigInt(0),
          speedUpMbpsSnapshot: plan.speedUpMbps,
          speedDownMbpsSnapshot: plan.speedDownMbps,
          deviceLimitSnapshot: plan.deviceLimit,
          cycles: {
            create: {
              startsAt: purchasedAt,
              endsAt: this.firstCycleEnd(purchasedAt, entitlementExpiresAt),
              grantedBytes: plan.trafficBytes,
            },
          },
        },
      });
    } else if (existing.planId === plan.id) {
      const extendsCurrentTerm = existing.endsAt > purchasedAt;
      const extensionBase = extendsCurrentTerm ? existing.endsAt : purchasedAt;
      entitlementExpiresAt = this.offerExpiry(
        extensionBase,
        offer,
        extendsCurrentTerm ? existing.startsAt : purchasedAt,
      );
      await tx.subscription.update({
        where: { id: existing.id },
        data: {
          nodeId,
          status: SubscriptionStatus.ACTIVE,
          startsAt: extendsCurrentTerm ? undefined : purchasedAt,
          endsAt: entitlementExpiresAt,
          accessAccountId: account.id,
          planOfferId: offer.id,
          includedTrafficBytes: extendsCurrentTerm
            ? undefined
            : plan.trafficBytes,
          bonusTrafficBytes: extendsCurrentTerm ? undefined : BigInt(0),
          consumedTrafficBytes: extendsCurrentTerm ? undefined : BigInt(0),
          speedUpMbpsSnapshot: plan.speedUpMbps,
          speedDownMbpsSnapshot: plan.speedDownMbps,
          deviceLimitSnapshot: plan.deviceLimit,
        },
      });
    } else {
      await tx.subscription.update({
        where: { id: existing.id },
        data: { status: SubscriptionStatus.CANCELED, endsAt: purchasedAt },
      });
      entitlementExpiresAt = this.offerExpiry(purchasedAt, offer);
      await tx.subscription.create({
        data: {
          planId: plan.id,
          userId,
          nodeId,
          accessAccountId: account.id,
          planOfferId: offer.id,
          status: SubscriptionStatus.ACTIVE,
          startsAt: purchasedAt,
          endsAt: entitlementExpiresAt,
          includedTrafficBytes: plan.trafficBytes,
          bonusTrafficBytes: BigInt(0),
          consumedTrafficBytes: BigInt(0),
          speedUpMbpsSnapshot: plan.speedUpMbps,
          speedDownMbpsSnapshot: plan.speedDownMbps,
          deviceLimitSnapshot: plan.deviceLimit,
          cycles: {
            create: {
              startsAt: purchasedAt,
              endsAt: this.firstCycleEnd(purchasedAt, entitlementExpiresAt),
              grantedBytes: plan.trafficBytes,
            },
          },
        },
      });
    }

    const order = await tx.manualOrder.create({
      data: {
        userId,
        planId: plan.id,
        planOfferId: offer.id,
        status: OrderStatus.APPLIED,
        kind: OrderKind.RENEWAL,
        source: OrderSource.WALLET,
        amountCents: chargedCents,
        basePriceCents: offer.priceCents,
        discountCents: discount?.discountCents ?? 0,
        currency: 'CNY',
        productSlugSnapshot: offer.slug,
        productNameSnapshot: `${plan.name} · ${offer.name}`,
        durationDays: offer.legacyDurationDays,
        trafficBytes: plan.trafficBytes,
        entitlementExpiresAt,
        billingPeriodSnapshot: offer.billingPeriod,
        intervalMonthsSnapshot: offer.intervalMonths,
        accessProfileIdSnapshot: plan.accessProfileId,
        idempotencyKey,
        processedAt: purchasedAt,
      },
    });
    await postWalletEntry(tx, {
      userId,
      orderId: order.id,
      amountCents: -chargedCents,
      kind: 'PURCHASE',
      idempotencyKey,
      note: `购买套餐 ${plan.name} · ${offer.name}`,
    });
    if (discount) {
      await tx.redemptionUse.create({
        data: { codeId: discount.codeId, userId, orderId: order.id },
      });
    }
    await tx.paymentRecord.create({
      data: {
        orderId: order.id,
        userId,
        source: 'WALLET',
        status: 'SETTLED',
        amountCents: chargedCents,
        currency: 'CNY',
        paidAt: purchasedAt,
        reconciledAt: purchasedAt,
      },
    });
    return {
      orderId: order.id,
      replayed: false,
      kind: input.kind,
      productName: `${plan.name} · ${offer.name}`,
      chargedCents,
      entitlementExpiresAt: entitlementExpiresAt.toISOString(),
    };
  }

  private async reserveDiscount(
    tx: Prisma.TransactionClient,
    userId: string,
    rawCode: string,
    basePriceCents: number,
  ) {
    const code = await tx.redemptionCode.findUnique({
      where: { code: rawCode.trim().toUpperCase() },
    });
    if (
      !code ||
      code.kind !== RedemptionCodeKind.DISCOUNT ||
      code.status !== RedemptionCodeStatus.ACTIVE ||
      code.usedCount >= code.maxUses ||
      (code.expiresAt && code.expiresAt <= new Date())
    ) {
      throw new BadRequestException('Discount code is not available');
    }
    const priorUse = await tx.redemptionUse.findUnique({
      where: { codeId_userId: { codeId: code.id, userId } },
    });
    if (priorUse) {
      throw new BadRequestException('Discount code was already used');
    }

    const discountCents = Math.min(
      code.discountPercent
        ? Math.floor((basePriceCents * code.discountPercent) / 100)
        : (code.discountCents ?? 0),
      basePriceCents,
    );
    const reserved = await tx.redemptionCode.updateMany({
      where: {
        id: code.id,
        status: RedemptionCodeStatus.ACTIVE,
        usedCount: { lt: code.maxUses },
      },
      data: { usedCount: { increment: 1 } },
    });
    if (reserved.count !== 1) {
      throw new BadRequestException('Discount code is no longer available');
    }
    return { codeId: code.id, discountCents };
  }

  private async previewDiscount(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
    rawCode: string,
    basePriceCents: number,
  ) {
    const code = await tx.redemptionCode.findUnique({
      where: { code: rawCode.trim().toUpperCase() },
    });
    if (
      !code ||
      code.kind !== RedemptionCodeKind.DISCOUNT ||
      code.status !== RedemptionCodeStatus.ACTIVE ||
      code.usedCount >= code.maxUses ||
      (code.expiresAt && code.expiresAt <= new Date())
    ) {
      throw new BadRequestException('Discount code is not available');
    }
    const priorUse = await tx.redemptionUse.findUnique({
      where: { codeId_userId: { codeId: code.id, userId } },
    });
    if (priorUse) {
      throw new BadRequestException('Discount code was already used');
    }
    return {
      label: code.label,
      discountCents: Math.min(
        code.discountPercent
          ? Math.floor((basePriceCents * code.discountPercent) / 100)
          : (code.discountCents ?? 0),
        basePriceCents,
      ),
    };
  }

  private async resolveQuoteProduct(input: CheckoutInput) {
    if ('offerId' in input) {
      const offer = await this.prisma.catalogOffer.findUnique({
        where: { id: input.offerId },
        include: {
          product: {
            include: {
              accessProfile: {
                include: {
                  nodeBindings: {
                    where: {
                      node: { active: true, lifecycleStatus: 'ACTIVE' },
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });
      if (!offer || offer.archivedAt) {
        throw new NotFoundException('Catalog offer not found');
      }
      if (
        !offer.active ||
        offer.product.status !== CatalogProductStatus.ACTIVE ||
        !offer.product.accessProfile?.active ||
        offer.product.accessProfile.nodeBindings.length === 0
      ) {
        throw new BadRequestException('Catalog offer is not purchasable');
      }
      return {
        id: offer.id,
        name: `${offer.product.name} · ${offer.name}`,
        productId: offer.product.id,
        productName: offer.product.name,
        priceCents: offer.priceCents,
        trafficBytes: offer.trafficBytes,
        series: offer.product.series,
        kind:
          offer.product.kind === CatalogProductKind.PLAN
            ? ('plan_offer' as const)
            : ('traffic_pack' as const),
        purchaseRules: offer.product,
      };
    }
    if (input.kind === 'traffic_pack') {
      const product = await this.prisma.trafficPackProduct.findUnique({
        where: { id: input.productId },
        include: {
          accessProfile: {
            include: {
              nodeBindings: { where: { node: { active: true } }, take: 1 },
            },
          },
        },
      });
      if (!product || product.archivedAt) {
        throw new NotFoundException('Product not found');
      }
      if (
        !product.active ||
        !product.validityDays ||
        !product.accessProfile?.active ||
        product.accessProfile.nodeBindings.length === 0
      ) {
        throw new BadRequestException('Product is not purchasable');
      }
      return {
        id: product.id,
        name: product.name,
        productId: product.id,
        productName: product.name,
        priceCents: product.priceCents,
        trafficBytes: product.trafficBytes,
        series: CatalogProductSeries.STANDARD,
        kind: 'traffic_pack' as const,
        purchaseRules: null,
      };
    }
    const { plan, offer } = await this.resolvePlanOffer(this.prisma, input);
    return {
      id: input.kind === 'plan' ? plan.id : offer.id,
      name: `${plan.name} · ${offer.name}`,
      productId: plan.id,
      productName: plan.name,
      priceCents: offer.priceCents,
      trafficBytes: plan.trafficBytes,
      series: CatalogProductSeries.STANDARD,
      kind: 'plan_offer' as const,
      purchaseRules: null,
    };
  }

  private async resolveUltraPurchase(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
    target: {
      id: string;
      name: string;
      priceCents: number;
      trafficBytes: bigint;
    },
  ) {
    const current = await client.entitlementGrant.findFirst({
      where: {
        userId,
        activeSlot: 'ULTRA',
        status: 'ACTIVE',
        endsAt: { gt: new Date() },
      },
      include: { product: { select: { name: true } } },
    });
    if (!current) {
      return {
        mode: 'initial' as const,
        payableCents: target.priceCents,
        grantId: null,
        productId: null,
        productName: null,
        priceCents: null,
        resetAnchorAt: null,
      };
    }
    const currentPrice = current.priceCentsSnapshot ?? 0;
    const currentTraffic = current.trafficBytesSnapshot ?? BigInt(0);
    if (
      target.id === current.productId ||
      target.priceCents <= currentPrice ||
      target.trafficBytes <= currentTraffic
    ) {
      throw new BadRequestException('当前已持有相同或更高的 Ultra 档位');
    }
    return {
      mode: 'upgrade' as const,
      payableCents: target.priceCents - currentPrice,
      grantId: current.id,
      productId: current.productId,
      productName: current.product.name,
      priceCents: currentPrice,
      resetAnchorAt: current.resetAnchorAt ?? current.startsAt,
    };
  }

  private async resolvePlanOffer(
    tx: Prisma.TransactionClient | PrismaService,
    input: Extract<CheckoutInput, { kind: 'plan' | 'plan_offer' }>,
  ) {
    if (input.kind === 'plan_offer') {
      const offer = await tx.planOffer.findUnique({
        where: { id: input.productId },
        include: { plan: true },
      });
      if (!offer || offer.archivedAt) {
        throw new NotFoundException('Plan offer not found');
      }
      if (!offer.active || !offer.plan.active) {
        throw new BadRequestException('Plan offer is inactive');
      }
      return { plan: offer.plan, offer };
    }
    const plan = await tx.plan.findUnique({ where: { id: input.productId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const offer = await tx.planOffer.findFirst({
      where: {
        planId: plan.id,
        active: true,
        archivedAt: null,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (!offer) {
      throw new BadRequestException('Plan has no active sales offer');
    }
    return { plan, offer };
  }

  private monthlyCycleBounds(anchor: Date, entitlementEnd: Date, now: Date) {
    let offset =
      (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      anchor.getUTCMonth();
    let startsAt = this.addMonthsClamped(anchor, offset);
    if (startsAt > now) {
      offset -= 1;
      startsAt = this.addMonthsClamped(anchor, offset);
    }
    let endsAt = this.addMonthsClamped(anchor, offset + 1);
    if (endsAt > entitlementEnd) endsAt = entitlementEnd;
    return { startsAt, endsAt };
  }

  private offerExpiry(
    startsAt: Date,
    offer: {
      billingPeriod: BillingPeriod;
      intervalMonths: number | null;
      legacyDurationDays: number | null;
    },
    renewalAnchor?: Date,
  ) {
    if (isPermanentBillingPeriod(offer.billingPeriod)) {
      return permanentEntitlementEnd();
    }
    if (offer.billingPeriod === BillingPeriod.LEGACY) {
      if (!offer.legacyDurationDays) {
        throw new BadRequestException('Legacy offer duration is invalid');
      }
      return this.addDays(startsAt, offer.legacyDurationDays);
    }
    if (!offer.intervalMonths) {
      throw new BadRequestException('Plan offer interval is invalid');
    }
    return this.addMonthsClamped(
      startsAt,
      offer.intervalMonths,
      renewalAnchor?.getUTCDate(),
    );
  }

  private firstCycleEnd(startsAt: Date, entitlementEndsAt: Date) {
    const monthly = this.addMonthsClamped(startsAt, 1);
    return monthly < entitlementEndsAt ? monthly : entitlementEndsAt;
  }

  private addMonthsClamped(
    date: Date,
    months: number,
    anchorDay = date.getUTCDate(),
  ) {
    const result = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() + months,
        1,
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds(),
      ),
    );
    const lastDay = new Date(
      Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();
    result.setUTCDate(Math.min(anchorDay, lastDay));
    return result;
  }

  private addDays(date: Date, days: number) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }
}
