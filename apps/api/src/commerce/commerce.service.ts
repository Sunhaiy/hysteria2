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
  CatalogProductStatus,
  OrderKind,
  OrderSource,
  OrderStatus,
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
import { ReferralService } from '../referrals/referral.service';
import {
  assertCatalogPurchaseEligibility,
  assertCatalogPurchaseLimit,
} from './purchase-eligibility';
import { parseCatalogOfferSnapshot } from './catalog-offer-snapshot';

export type CheckoutInput =
  | { offerId: string; discountCode?: string }
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
}

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
    if (product.purchaseRules) {
      await assertCatalogPurchaseEligibility(
        this.prisma,
        userId,
        product.purchaseRules,
      );
    }

    const discount = input.discountCode
      ? await this.previewDiscount(
          this.prisma,
          userId,
          input.discountCode,
          product.priceCents,
        )
      : null;
    const finalPriceCents = Math.max(
      product.priceCents - (discount?.discountCents ?? 0),
      0,
    );
    return {
      kind: 'kind' in input ? input.kind : product.kind,
      productId: product.id,
      productName: product.name,
      basePriceCents: product.priceCents,
      discountCents: discount?.discountCents ?? 0,
      discountLabel: discount?.label ?? null,
      finalPriceCents,
      balanceCents: user.balanceCents,
      sufficient: user.balanceCents >= finalPriceCents,
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
                },
                tx,
              );
              if (this.referrals) {
                await this.referrals.settlePlanCdkReward(
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
                  expiresAt: order.entitlementExpiresAt,
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
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 120) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    return this.prisma.$transaction(
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
          { complimentary: true, actorId },
        );
      },
      { isolationLevel: 'Serializable' },
    );
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
    return this.createOfferCheckout(
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
      product.accessProfile.nodeBindings.length === 0 ||
      !product.validityDays
    ) {
      throw new BadRequestException(
        'Traffic pack requires an active access profile and validity period',
      );
    }

    const purchasedAt = new Date();
    const subscription = await tx.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: purchasedAt },
      },
      orderBy: { endsAt: 'desc' },
    });
    if (!subscription) {
      throw new BadRequestException(
        'An active membership is required before purchasing a traffic pack',
      );
    }

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

    const debit = await tx.user.updateMany({
      where: { id: userId, balanceCents: { gte: chargedCents } },
      data: { balanceCents: { decrement: chargedCents } },
    });
    if (debit.count !== 1) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    await tx.walletTransaction.create({
      data: {
        userId,
        amountCents: -chargedCents,
        kind: 'PURCHASE',
        note: `Purchase traffic pack ${product.name}`,
      },
    });

    const productExpiresAt = this.addDays(purchasedAt, product.validityDays);
    const expiresAt =
      productExpiresAt < subscription.endsAt
        ? productExpiresAt
        : subscription.endsAt;
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
        entitlementExpiresAt: expiresAt,
        accessProfileIdSnapshot: product.accessProfileId,
        idempotencyKey,
        processedAt: purchasedAt,
      },
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

    return {
      orderId: order.id,
      replayed: false,
      kind: input.kind,
      productName: product.name,
      chargedCents,
      entitlementExpiresAt: expiresAt.toISOString(),
    };
  }

  private async createOfferCheckout(
    tx: Prisma.TransactionClient,
    userId: string,
    input: Extract<CheckoutInput, { offerId: string }>,
    idempotencyKey: string,
    options: {
      complimentary?: boolean;
      actorId?: string;
      externalPayment?: {
        attemptId: string;
        gatewayTradeNo: string;
        amountCents: number;
        basePriceCents: number;
        entitlementSnapshot: Prisma.JsonValue | null;
        paidAt: Date;
      };
    } = {},
  ): Promise<CheckoutResult> {
    if (options.complimentary && options.externalPayment) {
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
    if (!offer || (offer.archivedAt && !options.externalPayment)) {
      throw new NotFoundException('Catalog offer not found');
    }
    const snapshot = options.externalPayment
      ? parseCatalogOfferSnapshot(options.externalPayment.entitlementSnapshot)
      : null;
    if (
      snapshot &&
      (snapshot.offerId !== offer.id || snapshot.productId !== offer.product.id)
    ) {
      throw new ConflictException('External payment snapshot does not match');
    }
    const productKind = snapshot?.productKind ?? offer.product.kind;
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
      billingPeriod === BillingPeriod.LEGACY
        ? Boolean(legacyDurationDays && legacyDurationDays > 0)
        : Boolean(intervalMonths && intervalMonths > 0);
    if (
      (!options.externalPayment &&
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
    if (options.complimentary && productKind !== CatalogProductKind.PLAN) {
      throw new BadRequestException(
        'Complimentary grants require a plan offer',
      );
    }
    if (options.externalPayment) {
      await assertCatalogPurchaseLimit(tx, userId, {
        kind: productKind,
        purchaseLimitPerUser:
          snapshot?.purchaseLimitPerUser ?? offer.product.purchaseLimitPerUser,
        purchaseLimitKey:
          snapshot?.purchaseLimitKey ?? offer.product.purchaseLimitKey,
        requiresActivePlan,
      });
    } else {
      await assertCatalogPurchaseEligibility(tx, userId, offer.product);
    }
    const nodeId = await this.resolveServiceableNodeId(tx, accessProfileId);
    if (!nodeId) {
      throw new BadRequestException('Catalog offer has no serviceable node');
    }
    const discount =
      !options.complimentary && !options.externalPayment && input.discountCode
        ? await this.reserveDiscount(
            tx,
            userId,
            input.discountCode,
            offer.priceCents,
          )
        : null;
    const chargedCents = options.complimentary
      ? 0
      : options.externalPayment
        ? options.externalPayment.amountCents
        : Math.max(offer.priceCents - (discount?.discountCents ?? 0), 0);
    const basePriceCents =
      options.externalPayment?.basePriceCents ?? offer.priceCents;
    if (chargedCents < 0 || chargedCents > basePriceCents) {
      throw new BadRequestException('External payment amount is invalid');
    }
    if (!options.complimentary && !options.externalPayment) {
      const debit = await tx.user.updateMany({
        where: { id: userId, balanceCents: { gte: chargedCents } },
        data: { balanceCents: { decrement: chargedCents } },
      });
      if (debit.count !== 1) {
        throw new BadRequestException('Insufficient wallet balance');
      }
    }

    const purchasedAt = options.externalPayment?.paidAt ?? new Date();
    const expiryOffer = {
      billingPeriod,
      intervalMonths,
      legacyDurationDays,
    };
    const entitlementExpiresAt = this.offerExpiry(purchasedAt, expiryOffer);
    const account = await tx.accessAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    let subscriptionId: string | undefined;
    let trafficPackId: string | undefined;
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
        },
        orderBy: { endsAt: 'desc' },
      });
      if (
        existing &&
        existing.planId === legacyPlanId &&
        !options.complimentary
      ) {
        const extensionBase =
          existing.endsAt > purchasedAt ? existing.endsAt : purchasedAt;
        const extendedEndsAt = this.offerExpiry(extensionBase, expiryOffer);
        const updated = await tx.subscription.update({
          where: { id: existing.id },
          data: {
            nodeId,
            accessAccountId: account.id,
            planOfferId: legacyPlanOfferId,
            status: SubscriptionStatus.ACTIVE,
            endsAt: extendedEndsAt,
            includedTrafficBytes: trafficBytes,
            speedUpMbpsSnapshot: speedUpMbps,
            speedDownMbpsSnapshot: speedDownMbps,
            deviceLimitSnapshot: deviceLimit,
          },
        });
        subscriptionId = updated.id;
      } else {
        if (existing) {
          await tx.subscription.updateMany({
            where: {
              userId,
              status: {
                in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED],
              },
            },
            data: { status: SubscriptionStatus.CANCELED, endsAt: purchasedAt },
          });
        }
        const subscription = await tx.subscription.create({
          data: {
            userId,
            planId: legacyPlanId,
            nodeId,
            accessAccountId: account.id,
            planOfferId: legacyPlanOfferId,
            status: SubscriptionStatus.ACTIVE,
            startsAt: purchasedAt,
            endsAt: entitlementExpiresAt,
            includedTrafficBytes: trafficBytes,
            speedUpMbpsSnapshot: speedUpMbps,
            speedDownMbpsSnapshot: speedDownMbps,
            deviceLimitSnapshot: deviceLimit,
            cycles: {
              create: {
                startsAt: purchasedAt,
                endsAt: this.firstCycleEnd(purchasedAt, entitlementExpiresAt),
                grantedBytes: trafficBytes,
              },
            },
          },
        });
        subscriptionId = subscription.id;
      }
    } else {
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
          expiresAt: entitlementExpiresAt,
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
            ? basePriceCents - chargedCents
            : (discount?.discountCents ?? 0),
        currency,
        productSlugSnapshot: snapshot?.offerSlug ?? offer.slug,
        productNameSnapshot: `${snapshot?.productName ?? offer.product.name} · ${snapshot?.offerName ?? offer.name}`,
        validityDays:
          productKind === CatalogProductKind.TRAFFIC_PACK
            ? Math.round(
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
        idempotencyKey,
        processedAt: purchasedAt,
      },
    });
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
            paidAt: purchasedAt,
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
      const wallet = await tx.walletTransaction.create({
        data: {
          userId,
          amountCents: -chargedCents,
          kind: 'PURCHASE',
          note: `Purchase ${offer.product.name} · ${offer.name}`,
        },
      });
      await Promise.all([
        tx.walletLedgerEntry.create({
          data: {
            legacyTransactionId: wallet.id,
            userId,
            orderId: order.id,
            amountCents: -chargedCents,
            beforeBalanceCents: user.balanceCents,
            afterBalanceCents: user.balanceCents - chargedCents,
            kind: 'PURCHASE',
            idempotencyKey,
            note: `购买 ${offer.product.name} · ${offer.name}`,
          },
        }),
        tx.paymentRecord.create({
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
        }),
      ]);
    } else {
      await tx.auditLog.create({
        data: {
          actorId: options.actorId,
          action: 'COMPLIMENTARY_PLAN_GRANTED',
          targetType: 'ManualOrder',
          targetId: order.id,
          metadata: {
            userId,
            offerId: offer.id,
            listPriceCents: offer.priceCents,
            recognizedRevenueCents: 0,
          },
        },
      });
    }
    if (!this.entitlements) {
      throw new ConflictException('Entitlement module is unavailable');
    }
    await this.entitlements.grantFromOrder(
      { orderId: order.id, subscriptionId, trafficPackId },
      tx,
    );
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
    const debit = await tx.user.updateMany({
      where: { id: userId, balanceCents: { gte: chargedCents } },
      data: { balanceCents: { decrement: chargedCents } },
    });
    if (debit.count !== 1) {
      throw new BadRequestException('Insufficient wallet balance');
    }
    await tx.walletTransaction.create({
      data: {
        userId,
        amountCents: -chargedCents,
        kind: 'PURCHASE',
        note: `Purchase plan ${plan.name}`,
      },
    });

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
      const extensionBase =
        existing.endsAt > purchasedAt ? existing.endsAt : purchasedAt;
      entitlementExpiresAt = this.offerExpiry(extensionBase, offer);
      await tx.subscription.update({
        where: { id: existing.id },
        data: {
          nodeId,
          status: SubscriptionStatus.ACTIVE,
          endsAt: entitlementExpiresAt,
          accessAccountId: account.id,
          planOfferId: offer.id,
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
    if (discount) {
      await tx.redemptionUse.create({
        data: { codeId: discount.codeId, userId, orderId: order.id },
      });
    }
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
        priceCents: offer.priceCents,
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
        priceCents: product.priceCents,
        kind: 'traffic_pack' as const,
        purchaseRules: null,
      };
    }
    const { plan, offer } = await this.resolvePlanOffer(this.prisma, input);
    return {
      id: input.kind === 'plan' ? plan.id : offer.id,
      name: `${plan.name} · ${offer.name}`,
      priceCents: offer.priceCents,
      kind: 'plan_offer' as const,
      purchaseRules: null,
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

  private offerExpiry(
    startsAt: Date,
    offer: {
      billingPeriod: BillingPeriod;
      intervalMonths: number | null;
      legacyDurationDays: number | null;
    },
  ) {
    if (offer.billingPeriod === BillingPeriod.LEGACY) {
      if (!offer.legacyDurationDays) {
        throw new BadRequestException('Legacy offer duration is invalid');
      }
      return this.addDays(startsAt, offer.legacyDurationDays);
    }
    if (!offer.intervalMonths) {
      throw new BadRequestException('Plan offer interval is invalid');
    }
    return this.addMonthsClamped(startsAt, offer.intervalMonths);
  }

  private firstCycleEnd(startsAt: Date, entitlementEndsAt: Date) {
    const monthly = this.addMonthsClamped(startsAt, 1);
    return monthly < entitlementEndsAt ? monthly : entitlementEndsAt;
  }

  private addMonthsClamped(date: Date, months: number) {
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
    result.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    return result;
  }

  private addDays(date: Date, days: number) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }
}
