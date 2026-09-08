import {
  BillingPeriod,
  CatalogProductKind,
  CatalogProductSeries,
  GroupBuySettlementMode,
  Prisma,
  QuotaCadence,
} from '@prisma/client';
import type {
  PlanActivationMode,
  PlanActivationPreference,
} from './plan-purchase-policy';

export const catalogOfferSnapshotInclude =
  Prisma.validator<Prisma.CatalogOfferInclude>()({
    legacyPlanOffer: true,
    product: {
      include: {
        accessProfile: true,
        legacyPlan: true,
      },
    },
  });

type SnapshotOffer = Prisma.CatalogOfferGetPayload<{
  include: typeof catalogOfferSnapshotInclude;
}>;

export interface CatalogOfferSnapshot {
  version: 1 | 2;
  offerId: string;
  offerSlug: string;
  offerName: string;
  productId: string;
  productSlug: string;
  productName: string;
  productKind: CatalogProductKind;
  productSeries?: CatalogProductSeries;
  quotaCadence?: QuotaCadence;
  billingPeriod: BillingPeriod;
  intervalMonths: number | null;
  legacyDurationDays: number | null;
  trafficBytes: string;
  currency: string;
  accessProfileId: string;
  speedUpMbps: number;
  speedDownMbps: number;
  deviceLimit: number;
  trafficMultiplierBasisPoints: number;
  requiresActivePlan: boolean;
  purchaseLimitPerUser: number | null;
  purchaseLimitKey: string | null;
  legacyPlanId: string | null;
  legacyPlanOfferId: string | null;
  legacyTrafficPackProductId: string | null;
  purchaseMode?: 'initial' | 'upgrade' | 'plan_reset' | 'group_buy';
  upgradeFromGrantId?: string | null;
  upgradeFromProductId?: string | null;
  upgradeFromPriceCents?: number | null;
  resetAnchorAt?: string | null;
  resetGrantId?: string | null;
  resetBucketId?: string | null;
  resetCycleStartsAt?: string | null;
  resetCycleEndsAt?: string | null;
  resetTrafficBytes?: string | null;
  resetCreditBytes?: string | null;
  groupBuyId?: string | null;
  groupBuyMemberId?: string | null;
  groupBuyBonusBytes?: string | null;
  groupBuyOriginalPriceCents?: number | null;
  groupBuyPriceCents?: number | null;
  groupBuyDiscountBasisPoints?: number | null;
  groupBuySettlementMode?: GroupBuySettlementMode | null;
  planActivationPreference?: PlanActivationPreference | null;
  planActivationMode?: PlanActivationMode | null;
  planEffectiveAt?: string | null;
  currentPlanProductId?: string | null;
  currentPlanName?: string | null;
  currentPlanEndsAt?: string | null;
}

export interface CatalogOfferPurchaseContext {
  purchaseMode: 'initial' | 'upgrade' | 'plan_reset' | 'group_buy';
  upgradeFromGrantId?: string | null;
  upgradeFromProductId?: string | null;
  upgradeFromPriceCents?: number | null;
  resetAnchorAt?: string | null;
  resetGrantId?: string | null;
  resetBucketId?: string | null;
  resetCycleStartsAt?: string | null;
  resetCycleEndsAt?: string | null;
  resetTrafficBytes?: string | null;
  resetCreditBytes?: string | null;
  groupBuyId?: string | null;
  groupBuyMemberId?: string | null;
  groupBuyBonusBytes?: string | null;
  groupBuyOriginalPriceCents?: number | null;
  groupBuyPriceCents?: number | null;
  groupBuyDiscountBasisPoints?: number | null;
  groupBuySettlementMode?: GroupBuySettlementMode | null;
  planActivationPreference?: PlanActivationPreference | null;
  planActivationMode?: PlanActivationMode | null;
  planEffectiveAt?: string | null;
  currentPlanProductId?: string | null;
  currentPlanName?: string | null;
  currentPlanEndsAt?: string | null;
}

export function snapshotCatalogOffer(
  offer: SnapshotOffer,
  purchaseContext?: CatalogOfferPurchaseContext,
): CatalogOfferSnapshot {
  const profile = offer.product.accessProfile;
  if (!offer.product.accessProfileId || !profile) {
    throw new Error('Catalog offer access profile is missing');
  }
  return {
    version: 2,
    offerId: offer.id,
    offerSlug: offer.slug,
    offerName: offer.name,
    productId: offer.product.id,
    productSlug: offer.product.slug,
    productName: offer.product.name,
    productKind: offer.product.kind,
    productSeries: offer.product.series,
    quotaCadence: offer.product.quotaCadence,
    billingPeriod: offer.billingPeriod,
    intervalMonths: offer.intervalMonths,
    legacyDurationDays:
      offer.billingPeriod === BillingPeriod.LEGACY
        ? (offer.legacyPlanOffer?.legacyDurationDays ??
          offer.product.legacyPlan?.durationDays ??
          null)
        : null,
    trafficBytes: offer.trafficBytes.toString(),
    currency: offer.currency,
    accessProfileId: offer.product.accessProfileId,
    speedUpMbps: profile.speedUpMbps,
    speedDownMbps: profile.speedDownMbps,
    deviceLimit: profile.deviceLimit,
    trafficMultiplierBasisPoints:
      offer.product.defaultTrafficMultiplierBasisPoints,
    requiresActivePlan: offer.product.requiresActivePlan,
    purchaseLimitPerUser: offer.product.purchaseLimitPerUser,
    purchaseLimitKey: offer.product.purchaseLimitKey,
    legacyPlanId: offer.product.legacyPlanId,
    legacyPlanOfferId: offer.legacyPlanOfferId,
    legacyTrafficPackProductId: offer.product.legacyTrafficPackProductId,
    purchaseMode: purchaseContext?.purchaseMode ?? 'initial',
    upgradeFromGrantId: purchaseContext?.upgradeFromGrantId ?? null,
    upgradeFromProductId: purchaseContext?.upgradeFromProductId ?? null,
    upgradeFromPriceCents: purchaseContext?.upgradeFromPriceCents ?? null,
    resetAnchorAt: purchaseContext?.resetAnchorAt ?? null,
    resetGrantId: purchaseContext?.resetGrantId ?? null,
    resetBucketId: purchaseContext?.resetBucketId ?? null,
    resetCycleStartsAt: purchaseContext?.resetCycleStartsAt ?? null,
    resetCycleEndsAt: purchaseContext?.resetCycleEndsAt ?? null,
    resetTrafficBytes: purchaseContext?.resetTrafficBytes ?? null,
    resetCreditBytes: purchaseContext?.resetCreditBytes ?? null,
    groupBuyId: purchaseContext?.groupBuyId ?? null,
    groupBuyMemberId: purchaseContext?.groupBuyMemberId ?? null,
    groupBuyBonusBytes: purchaseContext?.groupBuyBonusBytes ?? null,
    groupBuyOriginalPriceCents:
      purchaseContext?.groupBuyOriginalPriceCents ?? null,
    groupBuyPriceCents: purchaseContext?.groupBuyPriceCents ?? null,
    groupBuyDiscountBasisPoints:
      purchaseContext?.groupBuyDiscountBasisPoints ?? null,
    groupBuySettlementMode: purchaseContext?.groupBuySettlementMode ?? null,
    planActivationPreference: purchaseContext?.planActivationPreference ?? null,
    planActivationMode: purchaseContext?.planActivationMode ?? null,
    planEffectiveAt: purchaseContext?.planEffectiveAt ?? null,
    currentPlanProductId: purchaseContext?.currentPlanProductId ?? null,
    currentPlanName: purchaseContext?.currentPlanName ?? null,
    currentPlanEndsAt: purchaseContext?.currentPlanEndsAt ?? null,
  };
}

export function parseCatalogOfferSnapshot(
  value: Prisma.JsonValue | null,
): CatalogOfferSnapshot | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.version !== 1 && candidate.version !== 2) ||
    typeof candidate.offerId !== 'string' ||
    typeof candidate.productId !== 'string' ||
    typeof candidate.accessProfileId !== 'string' ||
    typeof candidate.trafficBytes !== 'string' ||
    !/^\d+$/.test(candidate.trafficBytes) ||
    !Object.values(CatalogProductKind).includes(
      candidate.productKind as CatalogProductKind,
    ) ||
    !Object.values(BillingPeriod).includes(
      candidate.billingPeriod as BillingPeriod,
    )
  ) {
    throw new Error('易支付权益快照无效');
  }
  if (
    candidate.purchaseMode === 'plan_reset' &&
    (typeof candidate.resetGrantId !== 'string' ||
      typeof candidate.resetBucketId !== 'string' ||
      typeof candidate.resetCycleStartsAt !== 'string' ||
      typeof candidate.resetCycleEndsAt !== 'string' ||
      typeof candidate.resetTrafficBytes !== 'string' ||
      !/^\d+$/.test(candidate.resetTrafficBytes) ||
      (candidate.resetCreditBytes != null &&
        (typeof candidate.resetCreditBytes !== 'string' ||
          !/^\d+$/.test(candidate.resetCreditBytes))))
  ) {
    throw new Error('易支付流量重置快照无效');
  }
  if (
    candidate.purchaseMode === 'group_buy' &&
    (typeof candidate.groupBuyId !== 'string' ||
      typeof candidate.groupBuyMemberId !== 'string' ||
      typeof candidate.groupBuyBonusBytes !== 'string' ||
      !/^\d+$/.test(candidate.groupBuyBonusBytes) ||
      !Number.isInteger(candidate.groupBuyOriginalPriceCents) ||
      Number(candidate.groupBuyOriginalPriceCents) <= 0 ||
      !Number.isInteger(candidate.groupBuyPriceCents) ||
      Number(candidate.groupBuyPriceCents) <= 0 ||
      Number(candidate.groupBuyPriceCents) >
        Number(candidate.groupBuyOriginalPriceCents) ||
      !Number.isInteger(candidate.groupBuyDiscountBasisPoints) ||
      Number(candidate.groupBuyDiscountBasisPoints) < 100 ||
      Number(candidate.groupBuyDiscountBasisPoints) > 10_000 ||
      (candidate.groupBuySettlementMode != null &&
        !Object.values(GroupBuySettlementMode).includes(
          candidate.groupBuySettlementMode as GroupBuySettlementMode,
        )))
  ) {
    throw new Error('易支付拼团快照无效');
  }
  if (
    candidate.planActivationMode != null &&
    (typeof candidate.planActivationMode !== 'string' ||
      !['initial', 'renewal', 'scheduled_switch', 'immediate_switch'].includes(
        candidate.planActivationMode,
      ) ||
      typeof candidate.planEffectiveAt !== 'string' ||
      Number.isNaN(Date.parse(candidate.planEffectiveAt)))
  ) {
    throw new Error('易支付套餐生效策略快照无效');
  }
  return candidate as unknown as CatalogOfferSnapshot;
}
