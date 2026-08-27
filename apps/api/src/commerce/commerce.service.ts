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
    options: { complimentary?: boolean; actorId?: string } = {},
  ): Promise<CheckoutResult> {
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
    if (!offer || offer.archivedAt) {
      throw new NotFoundException('Catalog offer not found');
    }
    const legacyDurationDays =
      offer.billingPeriod === BillingPeriod.LEGACY
        ? (offer.legacyPlanOffer?.legacyDurationDays ??
          offer.product.legacyPlan?.durationDays ??
          null)
        : null;
    const hasValidDuration =
      offer.billingPeriod === BillingPeriod.LEGACY
        ? Boolean(legacyDurationDays && legacyDurationDays > 0)
        : Boolean(offer.intervalMonths && offer.intervalMonths > 0);
    if (
      !offer.active ||
      offer.product.status !== CatalogProductStatus.ACTIVE ||
      !offer.product.accessProfileId ||
      !offer.product.accessProfile?.active ||
      !hasValidDuration
    ) {
      throw new BadRequestException('Catalog offer is not purchasable');
    }
    if (
      options.complimentary &&
      offer.product.kind !== CatalogProductKind.PLAN
    ) {
      throw new BadRequestException(
        'Complimentary grants require a plan offer',
      );
    }
    const nodeId = await this.resolveServiceableNodeId(
      tx,
      offer.product.accessProfileId,
    );
    if (!nodeId) {
      throw new BadRequestException('Catalog offer has no serviceable node');
    }
    const discount =
      !options.complimentary && input.discountCode
        ? await this.reserveDiscount(
            tx,
            userId,
            input.discountCode,
            offer.priceCents,
          )
        : null;
    const chargedCents = options.complimentary
      ? 0
      : Math.max(offer.priceCents - (discount?.discountCents ?? 0), 0);
    if (!options.complimentary) {
      const debit = await tx.user.updateMany({
        where: { id: userId, balanceCents: { gte: chargedCents } },
        data: { balanceCents: { decrement: chargedCents } },
      });
      if (debit.count !== 1) {
        throw new BadRequestException('Insufficient wallet balance');
      }
    }

    const purchasedAt = new Date();
    const expiryOffer = {
      billingPeriod: offer.billingPeriod,
      intervalMonths: offer.intervalMonths,
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

    if (offer.product.kind === CatalogProductKind.PLAN) {
      const plan = offer.product.legacyPlan;
      if (!plan) {
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
      if (existing && existing.planId === plan.id && !options.complimentary) {
        const extensionBase =
          existing.endsAt > purchasedAt ? existing.endsAt : purchasedAt;
        const extendedEndsAt = this.offerExpiry(extensionBase, expiryOffer);
        const updated = await tx.subscription.update({
          where: { id: existing.id },
          data: {
            nodeId,
            accessAccountId: account.id,
            planOfferId: offer.legacyPlanOfferId,
            status: SubscriptionStatus.ACTIVE,
            endsAt: extendedEndsAt,
            includedTrafficBytes: offer.trafficBytes,
            speedUpMbpsSnapshot: offer.product.accessProfile.speedUpMbps,
            speedDownMbpsSnapshot: offer.product.accessProfile.speedDownMbps,
            deviceLimitSnapshot: offer.product.accessProfile.deviceLimit,
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
            planId: plan.id,
            nodeId,
            accessAccountId: account.id,
            planOfferId: offer.legacyPlanOfferId,
            status: SubscriptionStatus.ACTIVE,
            startsAt: purchasedAt,
            endsAt: entitlementExpiresAt,
            includedTrafficBytes: offer.trafficBytes,
            speedUpMbpsSnapshot: offer.product.accessProfile.speedUpMbps,
            speedDownMbpsSnapshot: offer.product.accessProfile.speedDownMbps,
            deviceLimitSnapshot: offer.product.accessProfile.deviceLimit,
            cycles: {
              create: {
                startsAt: purchasedAt,
                endsAt: this.firstCycleEnd(purchasedAt, entitlementExpiresAt),
                grantedBytes: offer.trafficBytes,
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
          subscriptionId: null,
          accessAccountId: account.id,
          trafficPackProductId: offer.product.legacyTrafficPackProductId,
          accessProfileId: offer.product.accessProfileId,
          label: `${offer.product.name} · ${offer.name}`,
          totalBytes: offer.trafficBytes,
          remainingBytes: offer.trafficBytes,
          status: TrafficPackStatus.ACTIVE,
          expiresAt: entitlementExpiresAt,
        },
      });
      trafficPackId = pack.id;
    }

    const order = await tx.manualOrder.create({
      data: {
        userId,
        planId:
          offer.product.kind === CatalogProductKind.PLAN
            ? offer.product.legacyPlanId
            : null,
        planOfferId: offer.legacyPlanOfferId,
        trafficPackProductId:
          offer.product.kind === CatalogProductKind.TRAFFIC_PACK
            ? offer.product.legacyTrafficPackProductId
            : null,
        catalogOfferId: offer.id,
        status: OrderStatus.APPLIED,
        kind:
          offer.product.kind === CatalogProductKind.PLAN
            ? OrderKind.RENEWAL
            : OrderKind.TRAFFIC_PACK,
        source: options.complimentary ? OrderSource.ADMIN : OrderSource.WALLET,
        amountCents: chargedCents,
        basePriceCents: offer.priceCents,
        discountCents: options.complimentary
          ? offer.priceCents
          : (discount?.discountCents ?? 0),
        currency: offer.currency,
        productSlugSnapshot: offer.slug,
        productNameSnapshot: `${offer.product.name} · ${offer.name}`,
        validityDays:
          offer.product.kind === CatalogProductKind.TRAFFIC_PACK
            ? Math.round(
                (entitlementExpiresAt.getTime() - purchasedAt.getTime()) /
                  (24 * 60 * 60 * 1000),
              )
            : null,
        trafficBytes: offer.trafficBytes,
        entitlementExpiresAt:
          offer.product.kind === CatalogProductKind.PLAN && subscriptionId
            ? (
                await tx.subscription.findUniqueOrThrow({
                  where: { id: subscriptionId },
                  select: { endsAt: true },
                })
              ).endsAt
            : entitlementExpiresAt,
        billingPeriodSnapshot: offer.billingPeriod,
        intervalMonthsSnapshot: offer.intervalMonths,
        accessProfileIdSnapshot: offer.product.accessProfileId,
        idempotencyKey,
        processedAt: purchasedAt,
      },
    });
    if (discount) {
      await tx.redemptionUse.create({
        data: { codeId: discount.codeId, userId, orderId: order.id },
      });
    }
    if (!options.complimentary) {
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
      };
    }
    const { plan, offer } = await this.resolvePlanOffer(this.prisma, input);
    return {
      id: input.kind === 'plan' ? plan.id : offer.id,
      name: `${plan.name} · ${offer.name}`,
      priceCents: offer.priceCents,
      kind: 'plan_offer' as const,
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
