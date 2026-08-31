import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { EpayPaymentStatus, Prisma } from '@prisma/client';
import { CommerceService } from '../commerce/commerce.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../security/secret-cipher.service';
import { SettingsService, type EpayConfig } from '../settings/settings.service';
import { apiPublicUrl } from '../common/public-url';
import {
  catalogOfferSnapshotInclude,
  snapshotCatalogOffer,
} from '../commerce/catalog-offer-snapshot';
import {
  createEpaySignature,
  formatEpayAmount,
  normalizeEpayParameters,
  parseEpayAmount,
  verifyEpaySignature,
  type EpayParameters,
} from './epay-signature';

const PAYMENT_TTL_MS = 30 * 60 * 1000;

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
  ) {}

  async createPayment(
    userId: string,
    offerId: string,
    idempotencyKey: string,
    discountCode?: string,
    paymentType?: 'alipay' | 'wxpay',
  ) {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 120) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    if (discountCode?.trim()) {
      throw new BadRequestException('易支付暂不支持优惠码');
    }

    const config = await this.requireConfiguredEpay(true);
    const selectedPaymentType = paymentType ?? config.paymentType;
    const [quote, offer] = await Promise.all([
      this.commerce.quoteCheckout(userId, { offerId }),
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
    if (quote.finalPriceCents !== offer.priceCents) {
      throw new ConflictException('商品价格已变化，请刷新后重试');
    }

    const now = new Date();
    const activeKey = `${userId}:${offer.product.purchaseLimitKey ?? offer.productId}`;
    try {
      const attempt = await this.prisma.$transaction(
        async (tx) => {
          await tx.epayPaymentAttempt.updateMany({
            where: {
              status: EpayPaymentStatus.PENDING,
              expiresAt: { lte: now },
            },
            data: {
              status: EpayPaymentStatus.EXPIRED,
              activeKey: null,
            },
          });

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
              replay.paymentType !== selectedPaymentType
            ) {
              throw new ConflictException(
                'Idempotency-Key was already used for another purchase',
              );
            }
            return replay;
          }

          const active = await tx.epayPaymentAttempt.findUnique({
            where: { activeKey },
          });
          if (active) {
            if (
              active.offerId !== offerId ||
              active.paymentType !== selectedPaymentType
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
            currentOffer.priceCents !== quote.finalPriceCents
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
              entitlementSnapshot: snapshotCatalogOffer(
                currentOffer,
              ) as unknown as Prisma.InputJsonValue,
              expiresAt: new Date(now.getTime() + PAYMENT_TTL_MS),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.presentAttempt(attempt, config);
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const replay = await this.prisma.epayPaymentAttempt.findFirst({
        where: {
          userId,
          OR: [{ idempotencyKey: normalizedKey }, { activeKey }],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!replay) throw error;
      if (
        replay.offerId !== offerId ||
        replay.paymentType !== selectedPaymentType
      ) {
        throw new ConflictException(
          '该商品已有一笔其他规格或支付方式的待支付订单',
        );
      }
      return this.presentAttempt(replay, config);
    }
  }

  async getPayment(userId: string, attemptId: string) {
    const attempt = await this.prisma.epayPaymentAttempt.findFirst({
      where: { id: attemptId, userId },
    });
    if (!attempt) throw new NotFoundException('支付订单不存在');
    return this.presentStatus(attempt);
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

    const currentConfig =
      attempt.merchantIdSnapshot && attempt.merchantKeyCiphertext
        ? null
        : await this.requireConfiguredEpay(false).catch(() => null);
    const merchantId = attempt.merchantIdSnapshot ?? currentConfig?.merchantId;
    let merchantKey: string | undefined;
    try {
      merchantKey = attempt.merchantKeyCiphertext
        ? this.cipher.decrypt(attempt.merchantKeyCiphertext)
        : currentConfig?.merchantKey;
    } catch {
      return { accepted: false, status: 'failed' };
    }
    if (
      parameters.sign_type?.toUpperCase() !== 'MD5' ||
      !merchantId ||
      !merchantKey ||
      parameters.pid !== merchantId ||
      parameters.trade_status !== 'TRADE_SUCCESS' ||
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

    for (let retry = 0; retry < 3; retry += 1) {
      try {
        const settled = await this.prisma.$transaction(
          async (tx) => {
            const attempt = await tx.epayPaymentAttempt.findUnique({
              where: { merchantOrderNo },
            });
            if (
              !attempt ||
              attempt.amountCents !== amountCents ||
              attempt.paymentType !== parameters.type
            ) {
              return null;
            }
            if (attempt.status === EpayPaymentStatus.SETTLED) {
              return attempt.gatewayTradeNo === gatewayTradeNo ? attempt : null;
            }

            const order = await this.commerce.fulfillEpayPayment(tx, {
              attemptId: attempt.id,
              userId: attempt.userId,
              offerId: attempt.offerId,
              merchantOrderNo,
              gatewayTradeNo,
              amountCents,
              basePriceCents: attempt.basePriceCents,
              entitlementSnapshot: attempt.entitlementSnapshot,
              paidAt: new Date(),
            });
            return tx.epayPaymentAttempt.update({
              where: { id: attempt.id },
              data: {
                orderId: order.orderId,
                gatewayTradeNo,
                status: EpayPaymentStatus.SETTLED,
                activeKey: null,
                settledAt: new Date(),
                failedAt: null,
                lastSettlementError: null,
                lastSettlementFailedAt: null,
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
        await this.recordSettlementFailure(merchantOrderNo, error);
        return { accepted: false, attemptId: attempt.id, status: 'failed' };
      }
    }
    return { accepted: false, status: 'failed' };
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

  private presentAttempt(
    attempt: {
      id: string;
      merchantOrderNo: string;
      status: EpayPaymentStatus;
      paymentType: string;
      gatewayUrlSnapshot: string | null;
      merchantIdSnapshot: string | null;
      merchantKeyCiphertext: string | null;
      amountCents: number;
      productNameSnapshot: string;
      expiresAt: Date;
      orderId: string | null;
      settlementFailureCount: number;
    },
    config: EpayConfig,
  ) {
    const status = this.presentStatus(attempt);
    if (attempt.status !== EpayPaymentStatus.PENDING) return status;
    const gatewayUrl = attempt.gatewayUrlSnapshot ?? config.gatewayUrl;
    const merchantId = attempt.merchantIdSnapshot ?? config.merchantId;
    const merchantKey = attempt.merchantKeyCiphertext
      ? this.cipher.decrypt(attempt.merchantKeyCiphertext)
      : config.merchantKey;
    if (!gatewayUrl || !merchantId || !merchantKey) {
      throw new ServiceUnavailableException('易支付尚未完成配置');
    }
    const fields: EpayParameters = {
      pid: merchantId,
      type: attempt.paymentType,
      out_trade_no: attempt.merchantOrderNo,
      notify_url: `${apiPublicUrl()}/api/payments/epay/notify`,
      return_url: `${apiPublicUrl()}/api/payments/epay/return`,
      name: attempt.productNameSnapshot,
      money: formatEpayAmount(attempt.amountCents),
      sign_type: 'MD5',
    };
    fields.sign = createEpaySignature(fields, merchantKey);
    return {
      ...status,
      gateway: {
        url: this.submitUrl(gatewayUrl),
        method: 'POST' as const,
        fields,
      },
    };
  }

  private presentStatus(attempt: {
    id: string;
    status: EpayPaymentStatus;
    amountCents: number;
    productNameSnapshot: string;
    expiresAt: Date;
    orderId: string | null;
    settlementFailureCount: number;
  }) {
    return {
      id: attempt.id,
      status: attempt.status.toLowerCase(),
      amountCents: attempt.amountCents,
      productName: attempt.productNameSnapshot,
      expiresAt: attempt.expiresAt.toISOString(),
      orderId: attempt.orderId,
      fulfillmentPending:
        attempt.status !== EpayPaymentStatus.SETTLED &&
        attempt.settlementFailureCount > 0,
    };
  }

  private async recordSettlementFailure(
    merchantOrderNo: string,
    error: unknown,
  ) {
    const message = this.describeSettlementError(error);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.epayPaymentAttempt.updateMany({
        where: {
          merchantOrderNo,
          status: { not: EpayPaymentStatus.SETTLED },
        },
        data: {
          settlementFailureCount: { increment: 1 },
          lastSettlementError: message,
          lastSettlementFailedAt: new Date(),
        },
      });
      if (updated.count === 0) return;
      await tx.auditLog.create({
        data: {
          action: 'EPAY_SETTLEMENT_FAILED',
          targetType: 'EpayPaymentAttempt',
          targetId: merchantOrderNo,
          metadata: { reason: message },
        },
      });
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
    if (!/\.php$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/submit.php`;
    }
    return parsed.toString();
  }

  private createMerchantOrderNo(now: Date) {
    const stamp = now
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);
    return `EP${stamp}${randomBytes(8).toString('hex').toUpperCase()}`;
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
