import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EpayPaymentStatus,
  EpayRefundStatus,
  GroupBuyMemberStatus,
  GroupBuyStatus,
  Prisma,
  PaymentFulfillmentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../security/secret-cipher.service';
import {
  buildEpayQueryUrl,
  createEpayQueryParameters,
  parseEpayQueryResponse,
  type EpayQueryOutcome,
} from '../epay/epay-query';
import {
  buildEpayRefundUrl,
  createEpayRefundParameters,
  parseEpayRefundResponse,
} from '../epay/epay-refund';
import { readEpayCredentialSnapshot } from '../epay/epay-credentials';
import { GroupBuyService } from './group-buy.service';
import { ACCOUNT_DELETION_REFUND_REASON } from './group-buy-account-cleanup';

const RESPONSE_LIMIT_BYTES = 64 * 1024;

interface RefundCredentials {
  gatewayUrl: string;
  merchantId: string;
  merchantKey: string;
}

@Injectable()
export class GroupBuyReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groupBuys: GroupBuyService,
    private readonly cipher: SecretCipherService,
  ) {}

  async reconcileDueRefunds(now = new Date()) {
    const expiredGroups = await this.groupBuys.expireDueGroups(now);
    const retryMs = this.integerFromEnv(
      'GROUP_BUY_REFUND_RETRY_MS',
      60_000,
      10_000,
      60 * 60_000,
    );
    const batchSize = this.integerFromEnv(
      'GROUP_BUY_REFUND_BATCH_SIZE',
      10,
      1,
      50,
    );
    const attempts = await this.prisma.epayRefundAttempt.findMany({
      where: {
        status: {
          in: [
            EpayRefundStatus.PENDING,
            EpayRefundStatus.SUBMITTED,
            EpayRefundStatus.FAILED,
          ],
        },
        OR: [
          { lastRequestedAt: null },
          { updatedAt: { lte: new Date(now.getTime() - retryMs) } },
        ],
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: { id: true },
    });
    const summary = {
      expiredGroups,
      checked: 0,
      refunded: 0,
      fallbackFulfilled: 0,
      exceptions: 0,
    };
    for (const attempt of attempts) {
      const outcome = await this.reconcileRefundAttempt(attempt.id);
      summary.checked += 1;
      summary[outcome] += 1;
    }
    return summary;
  }

  async retryRefundAttempt(id: string) {
    const exists = await this.prisma.epayRefundAttempt.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('支付退款记录不存在');
    return {
      refundAttemptId: id,
      outcome: await this.reconcileRefundAttempt(id),
    };
  }

  async retryFallbackFulfillment(memberId: string) {
    const result = await this.groupBuys.fallbackFulfillMember(memberId);
    if (!result) throw new NotFoundException('拼团成员无需重复发放');
    return {
      memberId,
      outcome: 'fallbackFulfilled' as const,
      orderId: result.orderId,
    };
  }

  private async reconcileRefundAttempt(
    id: string,
  ): Promise<'refunded' | 'fallbackFulfilled' | 'exceptions'> {
    const attempt = await this.prisma.epayRefundAttempt.findUnique({
      where: { id },
      include: {
        paymentAttempt: true,
        groupBuyMember: { include: { group: true } },
      },
    });
    if (!attempt) return 'exceptions';
    if (attempt.status === EpayRefundStatus.CONFIRMED) return 'refunded';
    if (attempt.groupBuyMember?.orderId) return 'fallbackFulfilled';
    if (
      attempt.paymentAttempt.status !== EpayPaymentStatus.SETTLED ||
      attempt.amountCents !== attempt.paymentAttempt.amountCents
    ) {
      await this.recordException(
        attempt.id,
        '拼团退款关联的付款状态或金额不正确',
      );
      return 'exceptions';
    }

    if (attempt.fallbackAllowedAt && attempt.groupBuyMember) {
      try {
        await this.prepareMemberRetry(attempt.id);
        const result = await this.groupBuys.fallbackFulfillMember(
          attempt.groupBuyMember.id,
        );
        return result ? 'fallbackFulfilled' : 'exceptions';
      } catch (error) {
        await this.recordException(attempt.id, this.describeError(error));
        return 'exceptions';
      }
    }

    let credentials: RefundCredentials;
    try {
      credentials = this.credentials(attempt.paymentAttempt);
      const before = await this.query(attempt.paymentAttempt, credentials);
      if (before.kind === 'refunded') {
        await this.confirmRefund(attempt.id);
        return 'refunded';
      }
      if (before.kind !== 'paid') {
        await this.recordException(
          attempt.id,
          `退款前查单状态异常：${before.kind}`,
        );
        return 'exceptions';
      }
      if (attempt.status === EpayRefundStatus.SUBMITTED) {
        await this.recordSubmittedPending(
          attempt.id,
          '退款请求已提交，但网关尚未确认退款',
        );
        return 'exceptions';
      }
    } catch (error) {
      if (attempt.status === EpayRefundStatus.SUBMITTED) {
        await this.recordSubmittedPending(
          attempt.id,
          this.describeError(error),
        );
      } else {
        await this.recordException(attempt.id, this.describeError(error));
      }
      return 'exceptions';
    }

    try {
      const claimed = await this.claimRefund(attempt.id);
      if (!claimed) return 'exceptions';
      const response = await this.submit(attempt.paymentAttempt, credentials);
      if (response.kind === 'rejected') {
        if (
          attempt.groupBuyMember &&
          attempt.reasonCode !== ACCOUNT_DELETION_REFUND_REASON
        ) {
          await this.allowFallback(attempt.id, response.message);
          const result = await this.groupBuys.fallbackFulfillMember(
            attempt.groupBuyMember.id,
          );
          return result ? 'fallbackFulfilled' : 'exceptions';
        }
        await this.recordException(
          attempt.id,
          `网关拒绝自动退款：${response.message}`,
        );
        return 'exceptions';
      }
      await this.markSubmitted(attempt.id, response.message);
      const after = await this.query(attempt.paymentAttempt, credentials);
      if (after.kind !== 'refunded') {
        await this.recordSubmittedPending(
          attempt.id,
          `退款请求已受理，但查单状态为 ${after.kind}`,
        );
        return 'exceptions';
      }
      await this.confirmRefund(attempt.id);
      return 'refunded';
    } catch (error) {
      await this.recordSubmittedPending(attempt.id, this.describeError(error));
      return 'exceptions';
    }
  }

  private credentials(payment: {
    gatewayUrlSnapshot: string | null;
    merchantIdSnapshot: string | null;
    merchantKeyCiphertext: string | null;
  }) {
    return readEpayCredentialSnapshot(
      payment,
      (ciphertext) => this.cipher.decrypt(ciphertext),
      '易支付退款订单',
    );
  }

  private async query(
    payment: {
      merchantOrderNo: string;
      paymentType: string;
      amountCents: number;
    },
    credentials: RefundCredentials,
  ): Promise<EpayQueryOutcome> {
    const url = buildEpayQueryUrl(credentials.gatewayUrl);
    url.search = new URLSearchParams(
      createEpayQueryParameters(
        credentials.merchantId,
        payment.merchantOrderNo,
        credentials.merchantKey,
      ),
    ).toString();
    const payload = await this.fetchJson(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
    });
    return parseEpayQueryResponse(
      payload,
      {
        merchantOrderNo: payment.merchantOrderNo,
        paymentType: payment.paymentType,
        amountCents: payment.amountCents,
      },
      credentials.merchantKey,
    );
  }

  private async submit(
    payment: {
      merchantOrderNo: string;
      gatewayTradeNo: string | null;
      amountCents: number;
    },
    credentials: RefundCredentials,
  ) {
    const body = createEpayRefundParameters({
      merchantId: credentials.merchantId,
      merchantKey: credentials.merchantKey,
      gatewayTradeNo: payment.gatewayTradeNo,
      merchantOrderNo: payment.merchantOrderNo,
      amountCents: payment.amountCents,
    });
    const payload = await this.fetchJson(
      buildEpayRefundUrl(credentials.gatewayUrl),
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        redirect: 'error',
      },
    );
    return parseEpayRefundResponse(payload);
  }

  private async fetchJson(url: URL, init: RequestInit) {
    const timeoutMs = this.integerFromEnv(
      'EPAY_REFUND_REQUEST_TIMEOUT_MS',
      8_000,
      1_000,
      30_000,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('易支付退款或查单请求失败，结果尚不确定');
    }
    if (!response.ok) throw new Error(`易支付网关返回 HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > RESPONSE_LIMIT_BYTES) throw new Error('易支付响应过大');
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > RESPONSE_LIMIT_BYTES) {
      throw new Error('易支付响应过大');
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error('易支付响应不是有效 JSON');
    }
  }

  private async claimRefund(id: string) {
    const claimed = await this.prisma.epayRefundAttempt.updateMany({
      where: {
        id,
        status: { in: [EpayRefundStatus.PENDING, EpayRefundStatus.FAILED] },
        fallbackAllowedAt: null,
      },
      data: {
        status: EpayRefundStatus.SUBMITTED,
        requestCount: { increment: 1 },
        lastRequestedAt: new Date(),
        lastError: null,
      },
    });
    return claimed.count === 1;
  }

  private markSubmitted(id: string, gatewayMessage: string) {
    return this.prisma.epayRefundAttempt.update({
      where: { id },
      data: {
        status: EpayRefundStatus.SUBMITTED,
        submittedAt: new Date(),
        gatewayMessage,
        lastError: null,
      },
    });
  }

  private recordSubmittedPending(id: string, message: string) {
    return this.prisma.epayRefundAttempt.updateMany({
      where: { id, status: EpayRefundStatus.SUBMITTED },
      data: { lastError: message.slice(0, 500) },
    });
  }

  private async allowFallback(id: string, gatewayMessage: string) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.epayRefundAttempt.update({
        where: { id },
        data: {
          status: EpayRefundStatus.FAILED,
          gatewayMessage,
          lastError: `网关明确拒绝退款：${gatewayMessage}`,
          fallbackAllowedAt: now,
        },
      });
      if (attempt.groupBuyMemberId) {
        await tx.groupBuyMember.update({
          where: { id: attempt.groupBuyMemberId },
          data: { status: GroupBuyMemberStatus.REFUND_PENDING },
        });
      }
    });
  }

  private async confirmRefund(id: string) {
    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const attempt = await tx.epayRefundAttempt.update({
          where: { id },
          data: {
            status: EpayRefundStatus.CONFIRMED,
            confirmedAt: now,
            lastError: null,
          },
        });
        await tx.epayPaymentAttempt.update({
          where: { id: attempt.paymentAttemptId },
          data: { fulfillmentStatus: PaymentFulfillmentStatus.REFUNDED },
        });
        if (!attempt.groupBuyMemberId) {
          await tx.auditLog.create({
            data: {
              action: 'epay.compensation_refund_confirmed',
              targetType: 'epay_payment_attempt',
              targetId: attempt.paymentAttemptId,
              metadata: {
                refundAttemptId: id,
                amountCents: attempt.amountCents,
                reasonCode: attempt.reasonCode,
              },
            },
          });
          return;
        }
        const member = await tx.groupBuyMember.update({
          where: { id: attempt.groupBuyMemberId },
          data: {
            status: GroupBuyMemberStatus.REFUNDED,
            activeSlot: null,
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'group_buy.refund_confirmed',
            targetType: 'group_buy_member',
            targetId: member.id,
            metadata: {
              refundAttemptId: id,
              amountCents: attempt.amountCents,
            },
          },
        });
        await this.groupBuys.refreshRefundingGroupStatus(
          tx,
          member.groupId,
          now,
        );
        return;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async prepareMemberRetry(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.epayRefundAttempt.findUnique({ where: { id } });
      if (!attempt?.groupBuyMemberId) return;
      const member = await tx.groupBuyMember.update({
        where: { id: attempt.groupBuyMemberId },
        data: { status: GroupBuyMemberStatus.REFUND_PENDING },
      });
      await tx.groupBuy.updateMany({
        where: {
          id: member.groupId,
          status: { in: [GroupBuyStatus.EXCEPTION, GroupBuyStatus.REFUNDING] },
        },
        data: { status: GroupBuyStatus.REFUNDING },
      });
    });
  }

  private async recordException(
    id: string,
    message: string,
    status: EpayRefundStatus = EpayRefundStatus.FAILED,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.epayRefundAttempt.update({
        where: { id },
        data: { status, lastError: message.slice(0, 500) },
      });
      await tx.epayPaymentAttempt.update({
        where: { id: attempt.paymentAttemptId },
        data: { fulfillmentStatus: PaymentFulfillmentStatus.MANUAL_REVIEW },
      });
      if (!attempt.groupBuyMemberId) return;
      const member = await tx.groupBuyMember.findUnique({
        where: { id: attempt.groupBuyMemberId },
      });
      if (
        member &&
        !member.orderId &&
        member.status !== GroupBuyMemberStatus.REFUNDED
      ) {
        await tx.groupBuyMember.update({
          where: { id: member.id },
          data: { status: GroupBuyMemberStatus.EXCEPTION },
        });
        await tx.groupBuy.updateMany({
          where: {
            id: member.groupId,
            status: { not: GroupBuyStatus.REFUNDED },
          },
          data: { status: GroupBuyStatus.EXCEPTION },
        });
      }
    });
  }

  private describeError(error: unknown) {
    return (error instanceof Error ? error.message : '未知退款错误').slice(
      0,
      500,
    );
  }

  private integerFromEnv(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const value = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(value)
      ? Math.min(maximum, Math.max(minimum, value))
      : fallback;
  }
}
