import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  type EpayGatewayTestAttempt,
  type EpayPaymentAttempt,
  EpayPaymentStatus,
  PaymentFulfillmentStatus,
  Prisma,
} from '@prisma/client';
import { CommerceService } from '../commerce/commerce.service';
import {
  isPaymentFulfillmentRejectedError,
  PaymentFulfillmentRejectedError,
} from '../commerce/payment-fulfillment.error';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../security/secret-cipher.service';
import { SettingsService } from '../settings/settings.service';
import { apiPublicUrl } from '../common/public-url';
import { GroupBuyService } from '../group-buy/group-buy.service';
import {
  catalogOfferSnapshotInclude,
  parseCatalogOfferSnapshot,
  snapshotCatalogOffer,
} from '../commerce/catalog-offer-snapshot';
import { type PlanActivationPreference } from '../commerce/plan-purchase-policy';
import {
  createEpaySignature,
  formatEpayAmount,
  normalizeEpayParameters,
  parseEpayAmount,
  verifyEpaySignature,
  type EpayParameters,
} from './epay-signature';
import { EpayCheckoutService } from './epay-checkout.service';
import {
  EpayCredentialSnapshotError,
  readEpayCredentialSnapshot,
} from './epay-credentials';
import {
  activeEpayCheckoutKey,
  PaymentAttemptLifecycleService,
} from '../payments/payment-attempt-lifecycle.service';

const PAYMENT_TTL_MS = 30 * 60 * 1000;
const GATEWAY_TEST_AMOUNT_CENTS = 1;

export interface EpayCallbackResult {
  accepted: boolean;
  attemptId?: string;
  status: 'success' | 'failed';
}

@Injectable()
export class EpayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly commerce: CommerceService,
    private readonly cipher: SecretCipherService,
    @Optional() private readonly checkout?: EpayCheckoutService,
    @Optional() private readonly groupBuys?: GroupBuyService,
    @Optional()
    private readonly paymentAttempts?: PaymentAttemptLifecycleService,
  ) {}

  async createPayment(
    userId: string,
    offerId: string,
    idempotencyKey: string,
    discountCode: string | undefined,
    paymentType: 'alipay' | 'wxpay',
    purchaseAction: 'purchase' | 'plan_reset' = 'purchase',
    planActivation?: PlanActivationPreference,
  ) {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 120) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    if (discountCode?.trim()) {
      throw new BadRequestException('易支付暂不支持优惠码');
    }

    const config = await this.requireConfiguredEpay(true);
    const selectedPaymentType = paymentType;
    const [quote, offer] = await Promise.all([
      this.commerce.quoteCheckout(userId, {
        offerId,
        purchaseAction,
        planActivation,
      }),
      this.prisma.catalogOffer.findUnique({
        where: { id: offerId },
        include: { product: true },
      }),
    ]);
    if (!offer || offer.archivedAt) {
      throw new NotFoundException('Catalog offer not found');
    }
    if (quote.finalPriceCents <= 0) {
      throw new BadRequestException('易支付订单金额必须大于零');
    }
    if (quote.basePriceCents !== offer.priceCents) {
      throw new ConflictException('商品价格已变化，请刷新后重试');
    }
    const resolvedPlanActivation = this.resolvedPlanActivation(
      quote.planActivationMode,
    );

    const now = new Date();
    const activeKey = activeEpayCheckoutKey(userId);
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        const attempt = await this.prisma.$transaction(
          async (tx) => {
            await this.expirePendingPayments(tx, now, userId);

            const replay = await tx.epayPaymentAttempt.findUnique({
              where: {
                userId_idempotencyKey: {
                  userId,
                  idempotencyKey: normalizedKey,
                },
              },
            });
            if (replay) {
              if (
                replay.offerId !== offerId ||
                replay.paymentType !== selectedPaymentType ||
                this.paymentPurchaseAction(replay.entitlementSnapshot) !==
                  purchaseAction ||
                this.paymentPlanActivation(replay.entitlementSnapshot) !==
                  resolvedPlanActivation
              ) {
                throw new ConflictException(
                  'Idempotency-Key was already used for another purchase',
                );
              }
              return replay;
            }

            await this.paymentAttempts?.abandonPendingPayments(tx, userId, now);

            const active = await tx.epayPaymentAttempt.findUnique({
              where: { activeKey },
            });
            if (active) {
              if (
                active.offerId !== offerId ||
                active.paymentType !== selectedPaymentType ||
                this.paymentPurchaseAction(active.entitlementSnapshot) !==
                  purchaseAction ||
                this.paymentPlanActivation(active.entitlementSnapshot) !==
                  resolvedPlanActivation
              ) {
                throw new ConflictException(
                  '该商品已有一笔其他规格或支付方式的待支付订单',
                );
              }
              return active;
            }

            const currentOffer = await tx.catalogOffer.findUnique({
              where: { id: offerId },
              include: catalogOfferSnapshotInclude,
            });
            if (
              !currentOffer ||
              currentOffer.archivedAt ||
              currentOffer.priceCents !== quote.basePriceCents
            ) {
              throw new ConflictException('商品已变化，请刷新后重试');
            }

            return tx.epayPaymentAttempt.create({
              data: {
                userId,
                offerId,
                merchantOrderNo: this.createMerchantOrderNo(now),
                idempotencyKey: normalizedKey,
                activeKey,
                paymentType: selectedPaymentType,
                gatewayUrlSnapshot: config.gatewayUrl,
                merchantIdSnapshot: config.merchantId,
                merchantKeyCiphertext: this.cipher.encrypt(config.merchantKey!),
                amountCents: quote.finalPriceCents,
                basePriceCents: quote.basePriceCents,
                currency: offer.currency,
                productNameSnapshot: quote.productName,
                entitlementSnapshot: snapshotCatalogOffer(currentOffer, {
                  purchaseMode: quote.purchaseMode,
                  upgradeFromGrantId: quote.upgradeFromGrantId,
                  upgradeFromProductId: quote.upgradeFromProductId,
                  upgradeFromPriceCents: quote.upgradeFromPriceCents,
                  resetAnchorAt: quote.resetAnchorAt,
                  resetGrantId: quote.resetGrantId,
                  resetBucketId: quote.resetBucketId,
                  resetCycleStartsAt: quote.resetCycleStartsAt,
                  resetCycleEndsAt: quote.resetCycleEndsAt,
                  resetTrafficBytes: quote.resetTrafficBytes,
                  resetCreditBytes:
                    quote.resetCreditBytes == null
                      ? null
                      : String(quote.resetCreditBytes),
                  planActivationPreference: resolvedPlanActivation,
                  planActivationMode: quote.planActivationMode,
                  planEffectiveAt: quote.planEffectiveAt,
                  currentPlanProductId: quote.currentPlanProductId,
                  currentPlanName: quote.currentPlanName,
                  currentPlanEndsAt: quote.currentPlanEndsAt,
                }) as unknown as Prisma.InputJsonValue,
                expiresAt: this.paymentExpiry(
                  now,
                  purchaseAction === 'plan_reset'
                    ? quote.resetCycleEndsAt
                    : null,
                ),
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return this.presentAttempt(attempt);
      } catch (error) {
        if (!this.isRetryableTransactionError(error)) throw error;
        if (this.isUniqueConflict(error)) {
          const replay = await this.prisma.epayPaymentAttempt.findUnique({
            where: {
              userId_idempotencyKey: {
                userId,
                idempotencyKey: normalizedKey,
              },
            },
          });
          if (replay) {
            if (
              replay.offerId !== offerId ||
              replay.paymentType !== selectedPaymentType ||
              this.paymentPurchaseAction(replay.entitlementSnapshot) !==
                purchaseAction ||
              this.paymentPlanActivation(replay.entitlementSnapshot) !==
                resolvedPlanActivation
            ) {
              throw new ConflictException(
                'Idempotency-Key was already used for another purchase',
              );
            }
            return this.presentAttempt(replay);
          }
        }
        if (retry === 2) throw error;
      }
    }
    throw new ConflictException('支付订单创建冲突，请重试');
  }

  async getPayment(userId: string, attemptId: string) {
    return this.prisma.$transaction(async (tx) => {
      let attempt = await tx.epayPaymentAttempt.findFirst({
        where: { id: attemptId, userId },
      });
      if (!attempt) throw new NotFoundException('支付订单不存在');
      if (
        attempt.status === EpayPaymentStatus.PENDING &&
        attempt.expiresAt <= new Date()
      ) {
        const expired = await tx.epayPaymentAttempt.updateMany({
          where: { id: attempt.id, status: EpayPaymentStatus.PENDING },
          data: { status: EpayPaymentStatus.EXPIRED, activeKey: null },
        });
        if (expired.count > 0) {
          await this.groupBuys?.closePayment(tx, attempt.id);
          attempt = {
            ...attempt,
            status: EpayPaymentStatus.EXPIRED,
            activeKey: null,
          };
        }
      }
      return this.presentStatus(attempt);
    });
  }

  async createGroupBuyPayment(
    userId: string,
    input:
      | { kind: 'create'; campaignId: string }
      | { kind: 'join'; groupId: string },
    paymentType: 'alipay' | 'wxpay' | 'balance',
    idempotencyKey: string,
    planActivation?: PlanActivationPreference,
  ) {
    if (!this.groupBuys) {
      throw new ServiceUnavailableException('拼团模块当前不可用');
    }
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 120) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    if (paymentType === 'balance') {
      return this.groupBuys.purchaseWithWallet(
        userId,
        input,
        normalizedKey,
        planActivation,
      );
    }
    const config = await this.requireConfiguredEpay(true);
    const now = new Date();
    let attempt: EpayPaymentAttempt | null = null;
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        attempt = await this.prisma.$transaction(
          async (tx) => {
            await this.expirePendingPayments(tx, now, userId);
            const replay = await tx.epayPaymentAttempt.findUnique({
              where: {
                userId_idempotencyKey: {
                  userId,
                  idempotencyKey: normalizedKey,
                },
              },
            });
            if (replay) {
              const replaySnapshot = parseCatalogOfferSnapshot(
                replay.entitlementSnapshot,
              );
              const replayGroupId = replaySnapshot?.groupBuyId;
              const replayGroup =
                input.kind === 'create' && replayGroupId
                  ? await tx.groupBuy.findUnique({
                      where: { id: replayGroupId },
                      select: { campaignId: true },
                    })
                  : null;
              if (
                replay.paymentType !== paymentType ||
                replaySnapshot?.purchaseMode !== 'group_buy' ||
                !this.groupPaymentActivationMatches(
                  replay.entitlementSnapshot,
                  planActivation,
                ) ||
                (input.kind === 'join' &&
                  replaySnapshot.groupBuyId !== input.groupId) ||
                (input.kind === 'create' &&
                  replayGroup?.campaignId !== input.campaignId)
              ) {
                throw new ConflictException(
                  'Idempotency-Key was already used for another purchase',
                );
              }
              return replay;
            }
            await this.paymentAttempts?.abandonPendingPayments(tx, userId, now);
            const prepared = await this.groupBuys!.preparePayment(
              tx,
              userId,
              input,
              now,
              planActivation,
            );
            if (prepared.existingAttempt) {
              if (prepared.existingAttempt.paymentType !== paymentType) {
                throw new ConflictException(
                  '该拼团已有其他支付方式的待支付订单',
                );
              }
              return prepared.existingAttempt;
            }
            if (
              prepared.member.orderId ||
              prepared.member.walletIdempotencyKey
            ) {
              throw new ConflictException('该拼团成员已经完成余额支付');
            }
            const created = await tx.epayPaymentAttempt.create({
              data: {
                userId,
                offerId: prepared.group.offerIdSnapshot,
                merchantOrderNo: this.createMerchantOrderNo(now, 'EPG'),
                idempotencyKey: normalizedKey,
                activeKey: activeEpayCheckoutKey(userId),
                paymentType,
                gatewayUrlSnapshot: config.gatewayUrl,
                merchantIdSnapshot: config.merchantId,
                merchantKeyCiphertext: this.cipher.encrypt(config.merchantKey!),
                amountCents:
                  prepared.snapshot.groupBuySettlementMode ===
                  'ORIGINAL_PRICE_BALANCE_REBATE'
                    ? (prepared.snapshot.groupBuyOriginalPriceCents ??
                      prepared.group.priceCentsSnapshot)
                    : prepared.group.priceCentsSnapshot,
                basePriceCents:
                  prepared.snapshot.groupBuyOriginalPriceCents ??
                  prepared.group.priceCentsSnapshot,
                currency: prepared.group.currencySnapshot,
                productNameSnapshot: `${prepared.offer.product.name} · ${prepared.offer.name} · 拼团`,
                entitlementSnapshot: prepared.snapshot,
                expiresAt: this.paymentExpiry(now, prepared.group.expiresAt),
              },
            });
            await this.groupBuys!.attachPayment(
              tx,
              prepared.member.id,
              created.id,
            );
            return created;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error) {
        if (this.isRetryableTransactionError(error) && retry < 2) continue;
        throw error;
      }
    }
    if (!attempt) {
      throw new ConflictException('拼团支付创建冲突，请重试');
    }
    return this.presentAttempt(attempt);
  }

  async createGatewayTest(
    requestedById: string,
    paymentType: 'alipay' | 'wxpay',
  ) {
    const config = await this.requireConfiguredEpay(false);
    const fingerprint = this.settings.epayConfigFingerprint({
      gatewayUrl: config.gatewayUrl!,
      merchantId: config.merchantId!,
      merchantKey: config.merchantKey!,
      paymentType,
    });
    const now = new Date();
    const activeKey = `${requestedById}:${fingerprint}:${paymentType}`;
    let attempt: EpayGatewayTestAttempt;
    try {
      attempt = await this.prisma.$transaction(
        async (tx) => {
          await tx.epayGatewayTestAttempt.updateMany({
            where: {
              status: EpayPaymentStatus.PENDING,
              expiresAt: { lte: now },
            },
            data: { status: EpayPaymentStatus.EXPIRED, activeKey: null },
          });
          const active = await tx.epayGatewayTestAttempt.findUnique({
            where: { activeKey },
          });
          if (active) return active;
          return tx.epayGatewayTestAttempt.create({
            data: {
              requestedById,
              merchantOrderNo: this.createMerchantOrderNo(now, 'EPT'),
              activeKey,
              paymentType,
              gatewayUrlSnapshot: config.gatewayUrl!,
              merchantIdSnapshot: config.merchantId!,
              merchantKeyCiphertext: this.cipher.encrypt(config.merchantKey!),
              configFingerprint: fingerprint,
              amountCents: GATEWAY_TEST_AMOUNT_CENTS,
              expiresAt: new Date(now.getTime() + PAYMENT_TTL_MS),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const replay = await this.prisma.epayGatewayTestAttempt.findUnique({
        where: { activeKey },
      });
      if (!replay) throw error;
      attempt = replay;
    }
    return this.presentGatewayTest(attempt, config.merchantKey!);
  }

  async latestGatewayTest() {
    const config = await this.settings.getEpayConfig();
    if (
      !config.configured ||
      !config.gatewayUrl ||
      !config.merchantId ||
      !config.merchantKey
    ) {
      return {
        configured: false,
        tested: false,
        status: 'not_tested',
        channels: {
          alipay: { tested: false, status: 'not_tested' },
          wxpay: { tested: false, status: 'not_tested' },
        },
      };
    }
    const paymentTypes = ['alipay', 'wxpay'] as const;
    const fingerprints = Object.fromEntries(
      paymentTypes.map((paymentType) => [
        paymentType,
        this.settings.epayConfigFingerprint({
          gatewayUrl: config.gatewayUrl!,
          merchantId: config.merchantId!,
          merchantKey: config.merchantKey!,
          paymentType,
        }),
      ]),
    ) as Record<(typeof paymentTypes)[number], string>;
    await this.prisma.epayGatewayTestAttempt.updateMany({
      where: {
        configFingerprint: { in: Object.values(fingerprints) },
        status: EpayPaymentStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: EpayPaymentStatus.EXPIRED, activeKey: null },
    });
    const attempts = await Promise.all(
      paymentTypes.map((paymentType) =>
        this.prisma.epayGatewayTestAttempt.findFirst({
          where: { configFingerprint: fingerprints[paymentType] },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    );
    const channels = Object.fromEntries(
      paymentTypes.map((paymentType, index) => {
        const attempt = attempts[index];
        return [
          paymentType,
          attempt
            ? {
                tested: attempt.status === EpayPaymentStatus.SETTLED,
                id: attempt.id,
                status: attempt.status.toLowerCase(),
                paymentType,
                amountCents: attempt.amountCents,
                createdAt: attempt.createdAt.toISOString(),
                settledAt: attempt.settledAt?.toISOString() ?? null,
                expiresAt: attempt.expiresAt.toISOString(),
                lastQueryAt: attempt.lastQueryAt?.toISOString() ?? null,
                queryFailureCount: attempt.queryFailureCount,
                lastQueryError: attempt.lastQueryError,
                closedAt: attempt.closedAt?.toISOString() ?? null,
              }
            : { tested: false, status: 'not_tested', paymentType },
        ];
      }),
    ) as Record<
      (typeof paymentTypes)[number],
      {
        tested: boolean;
        status: string;
        paymentType: 'alipay' | 'wxpay';
      }
    >;
    const current =
      channels[config.paymentType === 'wxpay' ? 'wxpay' : 'alipay'];
    const allTested = paymentTypes.every(
      (paymentType) => channels[paymentType].tested,
    );
    return {
      configured: true,
      ...current,
      tested: allTested,
      status: allTested ? 'settled' : 'not_tested',
      channels,
    };
  }

  async processGatewayTestCallback(
    input: Record<string, unknown>,
  ): Promise<EpayCallbackResult> {
    let parameters: EpayParameters;
    try {
      parameters = normalizeEpayParameters(input);
    } catch {
      return { accepted: false, status: 'failed' };
    }
    const merchantOrderNo = parameters.out_trade_no;
    const gatewayTradeNo = parameters.trade_no;
    if (!merchantOrderNo || !gatewayTradeNo || !parameters.money) {
      return { accepted: false, status: 'failed' };
    }
    const attempt = await this.prisma.epayGatewayTestAttempt.findUnique({
      where: { merchantOrderNo },
    });
    if (!attempt) return { accepted: false, status: 'failed' };
    let merchantKey: string;
    try {
      const decrypted = this.cipher.decrypt(attempt.merchantKeyCiphertext);
      if (!decrypted) return { accepted: false, status: 'failed' };
      merchantKey = decrypted;
    } catch {
      return { accepted: false, status: 'failed' };
    }
    if (
      parameters.sign_type?.toUpperCase() !== 'MD5' ||
      parameters.pid !== attempt.merchantIdSnapshot ||
      parameters.trade_status !== 'TRADE_SUCCESS' ||
      parameters.type !== attempt.paymentType ||
      !verifyEpaySignature(parameters, merchantKey)
    ) {
      return { accepted: false, status: 'failed' };
    }
    let amountCents: number;
    try {
      amountCents = parseEpayAmount(parameters.money);
    } catch {
      return { accepted: false, status: 'failed' };
    }
    if (amountCents !== attempt.amountCents) {
      return { accepted: false, status: 'failed' };
    }
    return this.settleVerifiedGatewayTest({
      attemptId: attempt.id,
      merchantOrderNo,
      gatewayTradeNo,
      amountCents,
      paymentType: parameters.type,
    });
  }

  async processCallback(
    input: Record<string, unknown>,
  ): Promise<EpayCallbackResult> {
    let parameters: EpayParameters;
    try {
      parameters = normalizeEpayParameters(input);
    } catch {
      return { accepted: false, status: 'failed' };
    }

    const merchantOrderNo = parameters.out_trade_no;
    const gatewayTradeNo = parameters.trade_no;
    if (!merchantOrderNo || !gatewayTradeNo || !parameters.money) {
      return { accepted: false, status: 'failed' };
    }

    const attempt = await this.prisma.epayPaymentAttempt.findUnique({
      where: { merchantOrderNo },
    });
    if (!attempt) return { accepted: false, status: 'failed' };

    let credentials;
    try {
      credentials = readEpayCredentialSnapshot(
        attempt,
        (ciphertext) => this.cipher.decrypt(ciphertext),
        '易支付回调订单',
      );
    } catch (error) {
      if (error instanceof EpayCredentialSnapshotError) {
        await this.markCredentialSnapshotForManualReview(attempt.id, error);
      }
      return { accepted: false, status: 'failed' };
    }
    if (
      parameters.sign_type?.toUpperCase() !== 'MD5' ||
      parameters.pid !== credentials.merchantId ||
      parameters.trade_status !== 'TRADE_SUCCESS' ||
      !verifyEpaySignature(parameters, credentials.merchantKey)
    ) {
      return { accepted: false, status: 'failed' };
    }

    let amountCents: number;
    try {
      amountCents = parseEpayAmount(parameters.money);
    } catch {
      return { accepted: false, status: 'failed' };
    }

    return this.settleVerifiedPayment({
      attemptId: attempt.id,
      merchantOrderNo,
      gatewayTradeNo,
      amountCents,
      paymentType: parameters.type ?? '',
      paidAt: new Date(),
    });
  }

  async settleVerifiedGatewayTest(input: {
    attemptId?: string;
    merchantOrderNo: string;
    gatewayTradeNo: string;
    amountCents: number;
    paymentType: string;
  }): Promise<EpayCallbackResult> {
    try {
      const settled = await this.prisma.$transaction(async (tx) => {
        const current = await tx.epayGatewayTestAttempt.findUnique({
          where: { merchantOrderNo: input.merchantOrderNo },
        });
        if (
          !current ||
          current.amountCents !== input.amountCents ||
          current.paymentType !== input.paymentType
        ) {
          return null;
        }
        if (current.status === EpayPaymentStatus.SETTLED) {
          return current.gatewayTradeNo === input.gatewayTradeNo
            ? current
            : null;
        }
        return tx.epayGatewayTestAttempt.update({
          where: { id: current.id },
          data: {
            status: EpayPaymentStatus.SETTLED,
            gatewayTradeNo: input.gatewayTradeNo,
            activeKey: null,
            settledAt: new Date(),
            closedAt: null,
            lastQueryError: null,
          },
        });
      });
      return settled
        ? { accepted: true, attemptId: settled.id, status: 'success' }
        : { accepted: false, status: 'failed' };
    } catch {
      return {
        accepted: false,
        attemptId: input.attemptId,
        status: 'failed',
      };
    }
  }

  async settleVerifiedPayment(input: {
    attemptId?: string;
    merchantOrderNo: string;
    gatewayTradeNo: string;
    amountCents: number;
    paymentType: string;
    paidAt: Date;
  }): Promise<EpayCallbackResult> {
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        const settled = await this.prisma.$transaction(
          async (tx) => {
            const attempt = await tx.epayPaymentAttempt.findUnique({
              where: { merchantOrderNo: input.merchantOrderNo },
            });
            if (
              !attempt ||
              attempt.amountCents !== input.amountCents ||
              attempt.paymentType !== input.paymentType
            ) {
              return null;
            }
            const snapshot = parseCatalogOfferSnapshot(
              attempt.entitlementSnapshot,
            );
            if (attempt.status === EpayPaymentStatus.SETTLED) {
              return attempt.gatewayTradeNo === input.gatewayTradeNo
                ? attempt
                : null;
            }
            if (attempt.abandonedAt) {
              throw new PaymentFulfillmentRejectedError(
                'SUPERSEDED_PAYMENT_PAID',
                '该支付订单已被新的下单请求替代，迟到款项将自动原路退回',
              );
            }

            if (snapshot?.purchaseMode === 'group_buy') {
              if (!this.groupBuys) {
                throw new ServiceUnavailableException('拼团模块当前不可用');
              }
              return this.groupBuys.settleVerifiedPayment(
                tx,
                attempt,
                {
                  attemptId: attempt.id,
                  userId: attempt.userId,
                  offerId: attempt.offerId,
                  merchantOrderNo: input.merchantOrderNo,
                  gatewayTradeNo: input.gatewayTradeNo,
                  amountCents: input.amountCents,
                  basePriceCents: attempt.basePriceCents,
                  entitlementSnapshot: attempt.entitlementSnapshot,
                  paidAt: input.paidAt,
                },
                snapshot,
              );
            }

            const order = await this.commerce.fulfillEpayPayment(tx, {
              attemptId: attempt.id,
              userId: attempt.userId,
              offerId: attempt.offerId,
              merchantOrderNo: input.merchantOrderNo,
              gatewayTradeNo: input.gatewayTradeNo,
              amountCents: input.amountCents,
              basePriceCents: attempt.basePriceCents,
              entitlementSnapshot: attempt.entitlementSnapshot,
              paidAt: input.paidAt,
            });
            return tx.epayPaymentAttempt.update({
              where: { id: attempt.id },
              data: {
                orderId: order.orderId,
                gatewayTradeNo: input.gatewayTradeNo,
                status: EpayPaymentStatus.SETTLED,
                fulfillmentStatus: PaymentFulfillmentStatus.APPLIED,
                activeKey: null,
                settledAt: input.paidAt,
                failedAt: null,
                closedAt: null,
                lastSettlementError: null,
                lastSettlementFailedAt: null,
                lastQueryError: null,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return settled
          ? { accepted: true, attemptId: settled.id, status: 'success' }
          : { accepted: false, status: 'failed' };
      } catch (error) {
        if (this.isRetryableTransactionError(error) && retry < 2) continue;
        const compensated = await this.recordSettlementFailure(
          input.merchantOrderNo,
          error,
          input,
        );
        if (compensated) {
          return {
            accepted: true,
            attemptId: input.attemptId,
            status: 'success',
          };
        }
        return {
          accepted: false,
          attemptId: input.attemptId,
          status: 'failed',
        };
      }
    }
    return { accepted: false, status: 'failed' };
  }

  private async expirePendingPayments(
    tx: Prisma.TransactionClient,
    now: Date,
    userId: string,
  ) {
    const where = {
      userId,
      status: EpayPaymentStatus.PENDING,
      expiresAt: { lte: now },
    } satisfies Prisma.EpayPaymentAttemptWhereInput;
    const groupPayments = this.groupBuys
      ? await tx.epayPaymentAttempt.findMany({
          where: {
            ...where,
            entitlementSnapshot: {
              path: ['purchaseMode'],
              equals: 'group_buy',
            },
          },
          select: { id: true },
        })
      : [];
    await tx.epayPaymentAttempt.updateMany({
      where,
      data: { status: EpayPaymentStatus.EXPIRED, activeKey: null },
    });
    for (const payment of groupPayments) {
      await this.groupBuys?.closePayment(tx, payment.id);
    }
  }

  private paymentExpiry(now: Date, upperBound?: string | Date | null) {
    const ttl = new Date(now.getTime() + PAYMENT_TTL_MS);
    if (!upperBound) return ttl;
    const bound =
      upperBound instanceof Date ? upperBound : new Date(upperBound);
    if (Number.isNaN(bound.getTime()) || bound <= now) {
      throw new ConflictException('支付关联的权益周期已经结束');
    }
    return bound < ttl ? bound : ttl;
  }

  private async requireConfiguredEpay(requireEnabled: boolean) {
    const config = await this.settings.getEpayConfig();
    if (requireEnabled && config.checkoutMode !== 'epay') {
      throw new BadRequestException('当前未启用易支付');
    }
    if (!config.configured) {
      throw new ServiceUnavailableException('易支付尚未完成配置');
    }
    return config;
  }

  private async presentAttempt(attempt: {
    id: string;
    merchantOrderNo: string;
    status: EpayPaymentStatus;
    fulfillmentStatus: PaymentFulfillmentStatus;
    paymentType: string;
    gatewayUrlSnapshot: string | null;
    merchantIdSnapshot: string | null;
    merchantKeyCiphertext: string | null;
    amountCents: number;
    productNameSnapshot: string;
    expiresAt: Date;
    orderId: string | null;
    settlementFailureCount: number;
  }) {
    const status = this.presentStatus(attempt);
    if (attempt.status !== EpayPaymentStatus.PENDING) return status;
    let credentials;
    try {
      credentials = readEpayCredentialSnapshot(attempt, (ciphertext) =>
        this.cipher.decrypt(ciphertext),
      );
    } catch (error) {
      if (error instanceof EpayCredentialSnapshotError) {
        await this.markCredentialSnapshotForManualReview(attempt.id, error);
        throw new ConflictException(
          '历史支付订单缺少完整凭据快照，请重新发起支付',
        );
      }
      throw error;
    }
    const fields: EpayParameters = {
      pid: credentials.merchantId,
      type: attempt.paymentType,
      out_trade_no: attempt.merchantOrderNo,
      notify_url: `${apiPublicUrl()}/api/payments/epay/notify`,
      return_url: `${apiPublicUrl()}/api/payments/epay/return`,
      name: attempt.productNameSnapshot,
      money: formatEpayAmount(attempt.amountCents),
      sign_type: 'MD5',
    };
    fields.sign = createEpaySignature(fields, credentials.merchantKey);
    const gateway = {
      url: this.submitUrl(credentials.gatewayUrl),
      method: 'POST' as const,
      fields,
    };
    return {
      ...status,
      gateway: this.checkout ? await this.checkout.prepare(gateway) : gateway,
    };
  }

  private async presentGatewayTest(
    attempt: {
      id: string;
      merchantOrderNo: string;
      status: EpayPaymentStatus;
      paymentType: string;
      gatewayUrlSnapshot: string;
      merchantIdSnapshot: string;
      amountCents: number;
      expiresAt: Date;
      settledAt: Date | null;
    },
    merchantKey: string,
  ) {
    const status = {
      id: attempt.id,
      status: attempt.status.toLowerCase(),
      amountCents: attempt.amountCents,
      paymentType: attempt.paymentType,
      expiresAt: attempt.expiresAt.toISOString(),
      settledAt: attempt.settledAt?.toISOString() ?? null,
    };
    if (attempt.status !== EpayPaymentStatus.PENDING) return status;
    const fields: EpayParameters = {
      pid: attempt.merchantIdSnapshot,
      type: attempt.paymentType,
      out_trade_no: attempt.merchantOrderNo,
      notify_url: `${apiPublicUrl()}/api/payments/epay/test-notify`,
      return_url: `${apiPublicUrl()}/api/payments/epay/test-return`,
      name: '易支付通道测试（不发放商品）',
      money: formatEpayAmount(attempt.amountCents),
      sign_type: 'MD5',
    };
    fields.sign = createEpaySignature(fields, merchantKey);
    const gateway = {
      url: this.submitUrl(attempt.gatewayUrlSnapshot),
      method: 'POST' as const,
      fields,
    };
    return {
      ...status,
      gateway: this.checkout ? await this.checkout.prepare(gateway) : gateway,
    };
  }

  private presentStatus(attempt: {
    id: string;
    status: EpayPaymentStatus;
    fulfillmentStatus?: PaymentFulfillmentStatus;
    amountCents: number;
    productNameSnapshot: string;
    expiresAt: Date;
    orderId: string | null;
    settlementFailureCount: number;
    entitlementSnapshot?: Prisma.JsonValue | null;
  }) {
    const fulfillmentStatus =
      attempt.fulfillmentStatus ??
      (attempt.orderId
        ? PaymentFulfillmentStatus.APPLIED
        : PaymentFulfillmentStatus.PENDING);
    let snapshot: ReturnType<typeof parseCatalogOfferSnapshot> = null;
    try {
      snapshot = parseCatalogOfferSnapshot(attempt.entitlementSnapshot ?? null);
    } catch {
      snapshot = null;
    }
    return {
      id: attempt.id,
      status: attempt.status.toLowerCase(),
      fulfillmentStatus: fulfillmentStatus.toLowerCase(),
      amountCents: attempt.amountCents,
      productName: attempt.productNameSnapshot,
      expiresAt: attempt.expiresAt.toISOString(),
      orderId: attempt.orderId,
      fulfillmentPending:
        attempt.settlementFailureCount > 0 &&
        fulfillmentStatus !== PaymentFulfillmentStatus.APPLIED &&
        fulfillmentStatus !== PaymentFulfillmentStatus.REFUNDED,
      planActivationMode: snapshot?.planActivationMode ?? null,
      planEffectiveAt: snapshot?.planEffectiveAt ?? null,
    };
  }

  private async recordSettlementFailure(
    merchantOrderNo: string,
    error: unknown,
    payment?: {
      gatewayTradeNo: string;
      paidAt: Date;
    },
  ) {
    const message = this.describeSettlementError(error);
    const nonRetryable = isPaymentFulfillmentRejectedError(error);
    return this.prisma.$transaction(async (tx) => {
      if (nonRetryable && payment) {
        const attempt = await tx.epayPaymentAttempt.findUnique({
          where: { merchantOrderNo },
        });
        if (!attempt) return false;
        if (attempt.orderId) return false;
        await tx.epayPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            gatewayTradeNo: payment.gatewayTradeNo,
            status: EpayPaymentStatus.SETTLED,
            fulfillmentStatus: PaymentFulfillmentStatus.REFUND_PENDING,
            activeKey: null,
            settledAt: payment.paidAt,
            settlementFailureCount: { increment: 1 },
            lastSettlementError: message,
            lastSettlementFailedAt: new Date(),
          },
        });
        await tx.epayRefundAttempt.upsert({
          where: { paymentAttemptId: attempt.id },
          create: {
            paymentAttemptId: attempt.id,
            amountCents: attempt.amountCents,
            reasonCode: error.reasonCode,
          },
          update: {},
        });
        await tx.auditLog.create({
          data: {
            action: 'EPAY_FULFILLMENT_COMPENSATION_QUEUED',
            targetType: 'EpayPaymentAttempt',
            targetId: attempt.id,
            metadata: { reasonCode: error.reasonCode, reason: message },
          },
        });
        return true;
      }
      const updated = await tx.epayPaymentAttempt.updateMany({
        where: {
          merchantOrderNo,
          status: { not: EpayPaymentStatus.SETTLED },
        },
        data: {
          fulfillmentStatus: PaymentFulfillmentStatus.RETRYING,
          settlementFailureCount: { increment: 1 },
          lastSettlementError: message,
          lastSettlementFailedAt: new Date(),
        },
      });
      if (updated.count === 0) return false;
      await tx.auditLog.create({
        data: {
          action: 'EPAY_SETTLEMENT_FAILED',
          targetType: 'EpayPaymentAttempt',
          targetId: merchantOrderNo,
          metadata: { reason: message },
        },
      });
      return false;
    });
  }

  private markCredentialSnapshotForManualReview(
    attemptId: string,
    error: EpayCredentialSnapshotError,
  ) {
    const now = new Date();
    return this.prisma.epayPaymentAttempt.updateMany({
      where: {
        id: attemptId,
        orderId: null,
        fulfillmentStatus: { not: PaymentFulfillmentStatus.APPLIED },
      },
      data: {
        activeKey: null,
        fulfillmentStatus: PaymentFulfillmentStatus.MANUAL_REVIEW,
        lastSettlementError: error.message.slice(0, 500),
        lastSettlementFailedAt: now,
      },
    });
  }

  private describeSettlementError(error: unknown) {
    const response =
      error instanceof HttpException ? error.getResponse() : null;
    const message =
      typeof response === 'string'
        ? response
        : response &&
            typeof response === 'object' &&
            'message' in response &&
            typeof response.message === 'string'
          ? response.message
          : error instanceof Error
            ? `${error.name}: ${error.message}`
            : 'Unknown settlement failure';
    return message.slice(0, 500);
  }

  private submitUrl(gatewayUrl: string) {
    const parsed = new URL(gatewayUrl);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!/(?:\.php|\/submit)$/i.test(pathname)) {
      parsed.pathname = `${pathname}/submit.php`;
    } else {
      parsed.pathname = pathname;
    }
    return parsed.toString();
  }

  private createMerchantOrderNo(now: Date, prefix = 'EP') {
    const stamp = now
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);
    return `${prefix}${stamp}${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  private paymentPurchaseAction(value: Prisma.JsonValue | null) {
    try {
      return parseCatalogOfferSnapshot(value)?.purchaseMode === 'plan_reset'
        ? ('plan_reset' as const)
        : ('purchase' as const);
    } catch {
      return 'purchase' as const;
    }
  }

  private paymentPlanActivation(value: Prisma.JsonValue | null) {
    try {
      return parseCatalogOfferSnapshot(value)?.planActivationPreference ?? null;
    } catch {
      return null;
    }
  }

  private resolvedPlanActivation(
    mode: string | null | undefined,
  ): PlanActivationPreference | null {
    if (mode === 'scheduled_switch') return 'scheduled_switch';
    if (mode === 'immediate_switch') return 'immediate_switch';
    return null;
  }

  private groupPaymentActivationMatches(
    value: Prisma.JsonValue | null,
    preference?: PlanActivationPreference,
  ) {
    try {
      const snapshot = parseCatalogOfferSnapshot(value);
      if (!snapshot) return false;
      if (
        snapshot.planActivationMode !== 'scheduled_switch' &&
        snapshot.planActivationMode !== 'immediate_switch'
      ) {
        return true;
      }
      return (
        snapshot.planActivationPreference === (preference ?? 'scheduled_switch')
      );
    } catch {
      return false;
    }
  }

  private isUniqueConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isRetryableTransactionError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2002')
    );
  }
}
