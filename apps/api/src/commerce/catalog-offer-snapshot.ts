import {
  BillingPeriod,
  CatalogProductKind,
  CatalogProductSeries,
  Prisma,
  QuotaCadence,
} from '@prisma/client';

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
  purchaseMode?: 'initial' | 'upgrade' | 'plan_reset';
  upgradeFromGrantId?: string | null;
  upgradeFromProductId?: string | null;
  upgradeFromPriceCents?: number | null;
  resetAnchorAt?: string | null;
  resetGrantId?: string | null;
  resetBucketId?: string | null;
  resetCycleStartsAt?: string | null;
  resetCycleEndsAt?: string | null;
  resetTrafficBytes?: string | null;
}

export interface CatalogOfferPurchaseContext {
  purchaseMode: 'initial' | 'upgrade' | 'plan_reset';
  upgradeFromGrantId?: string | null;
  upgradeFromProductId?: string | null;
  upgradeFromPriceCents?: number | null;
  resetAnchorAt?: string | null;
  resetGrantId?: string | null;
  resetBucketId?: string | null;
  resetCycleStartsAt?: string | null;
  resetCycleEndsAt?: string | null;
  resetTrafficBytes?: string | null;
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
      !/^\d+$/.test(candidate.resetTrafficBytes))
  ) {
    throw new Error('易支付流量重置快照无效');
  }
  return candidate as unknown as CatalogOfferSnapshot;
}
