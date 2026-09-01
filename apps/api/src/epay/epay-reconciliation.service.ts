import { Injectable } from '@nestjs/common';
import {
  type EpayGatewayTestAttempt,
  type EpayPaymentAttempt,
  EpayPaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../security/secret-cipher.service';
import { SettingsService } from '../settings/settings.service';
import {
  buildEpayQueryUrl,
  createEpayQueryParameters,
  parseEpayQueryResponse,
  type EpayQueryOutcome,
} from './epay-query';
import { EpayService } from './epay.service';

const RESPONSE_LIMIT_BYTES = 64 * 1024;

type QueryablePaymentAttempt = EpayPaymentAttempt;
type QueryableGatewayTestAttempt = EpayGatewayTestAttempt;

interface QueryCredentials {
  gatewayUrl: string;
  merchantId: string;
  merchantKey: string;
}

@Injectable()
export class EpayReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly epay: EpayService,
    private readonly cipher: SecretCipherService,
    private readonly settings: SettingsService,
  ) {}

  async reconcileDueAttempts() {
    const now = new Date();
    const batchSize = this.integerFromEnv(
      'EPAY_RECONCILIATION_BATCH_SIZE',
      10,
      1,
      50,
    );
    const minAgeMs = this.integerFromEnv(
      'EPAY_RECONCILIATION_MIN_AGE_MS',
      15_000,
      5_000,
      10 * 60_000,
    );
    const retryMs = this.integerFromEnv(
      'EPAY_RECONCILIATION_RETRY_MS',
      30_000,
      5_000,
      60 * 60_000,
    );
    const lookbackHours = this.integerFromEnv(
      'EPAY_RECONCILIATION_LOOKBACK_HOURS',
      24,
      1,
      24 * 7,
    );
    const dueWhere = {
      status: {
        in: [
          EpayPaymentStatus.PENDING,
          EpayPaymentStatus.EXPIRED,
          EpayPaymentStatus.FAILED,
        ],
      },
      closedAt: null,
      createdAt: {
        gte: new Date(now.getTime() - lookbackHours * 60 * 60_000),
        lte: new Date(now.getTime() - minAgeMs),
      },
      OR: [
        { lastQueryAt: null },
        { lastQueryAt: { lte: new Date(now.getTime() - retryMs) } },
      ],
    } satisfies Prisma.EpayPaymentAttemptWhereInput;

    const [payments, tests] = await Promise.all([
      this.prisma.epayPaymentAttempt.findMany({
        where: { ...dueWhere, orderId: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
      }),
      this.prisma.epayGatewayTestAttempt.findMany({
        where: dueWhere,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
      }),
    ]);

    const summary = {
      checked: 0,
      settled: 0,
      pending: 0,
      closed: 0,
      notFound: 0,
      failed: 0,
    };
    for (const attempt of payments) {
      const outcome = await this.reconcilePayment(attempt);
      summary.checked += 1;
      summary[outcome] += 1;
    }
    for (const attempt of tests) {
      const outcome = await this.reconcileGatewayTest(attempt);
      summary.checked += 1;
      summary[outcome] += 1;
    }
    return summary;
  }

  private async reconcilePayment(
    attempt: QueryablePaymentAttempt,
  ): Promise<'settled' | 'pending' | 'closed' | 'notFound' | 'failed'> {
    try {
      const credentials = await this.paymentCredentials(attempt);
      const outcome = await this.query(attempt, credentials);
      return await this.applyPaymentOutcome(attempt, outcome);
    } catch (error) {
      await this.recordPaymentQueryFailure(attempt.id, error);
      return 'failed';
    }
  }

  private async reconcileGatewayTest(
    attempt: QueryableGatewayTestAttempt,
  ): Promise<'settled' | 'pending' | 'closed' | 'notFound' | 'failed'> {
    try {
      const credentials = this.testCredentials(attempt);
      const outcome = await this.query(attempt, credentials);
      return await this.applyTestOutcome(attempt, outcome);
    } catch (error) {
      await this.recordTestQueryFailure(attempt.id, error);
      return 'failed';
    }
  }

  private async applyPaymentOutcome(
    attempt: QueryablePaymentAttempt,
    outcome: EpayQueryOutcome,
  ) {
    switch (outcome.kind) {
      case 'paid': {
        const result = await this.epay.settleVerifiedPayment({
          merchantOrderNo: attempt.merchantOrderNo,
          gatewayTradeNo: outcome.gatewayTradeNo,
          amountCents: attempt.amountCents,
          paymentType: attempt.paymentType,
          paidAt: new Date(),
        });
        if (!result.accepted) {
          throw new Error('已验证的易支付订单未能完成权益结算');
        }
        await this.markPaymentQueried(attempt.id);
        return 'settled' as const;
      }
      case 'pending':
        await this.markPaymentQueried(attempt.id);
        return 'pending' as const;
      case 'closed':
        await this.closePayment(attempt);
        return 'closed' as const;
      case 'not_found':
        await this.recordPaymentQueryFailure(
          attempt.id,
          new Error('易支付网关未找到订单'),
        );
        return 'notFound' as const;
    }
  }

  private async applyTestOutcome(
    attempt: QueryableGatewayTestAttempt,
    outcome: EpayQueryOutcome,
  ) {
    switch (outcome.kind) {
      case 'paid': {
        const result = await this.epay.settleVerifiedGatewayTest({
          merchantOrderNo: attempt.merchantOrderNo,
          gatewayTradeNo: outcome.gatewayTradeNo,
          amountCents: attempt.amountCents,
          paymentType: attempt.paymentType,
        });
        if (!result.accepted) {
          throw new Error('已验证的易支付测试单未能完成结算');
        }
        await this.markTestQueried(attempt.id);
        return 'settled' as const;
      }
      case 'pending':
        await this.markTestQueried(attempt.id);
        return 'pending' as const;
      case 'closed':
        await this.closeGatewayTest(attempt);
        return 'closed' as const;
      case 'not_found':
        await this.recordTestQueryFailure(
          attempt.id,
          new Error('易支付网关未找到测试订单'),
        );
        return 'notFound' as const;
    }
  }

  private async query(
    attempt: {
      merchantOrderNo: string;
      paymentType: string;
      amountCents: number;
    },
    credentials: QueryCredentials,
  ) {
    const url = buildEpayQueryUrl(credentials.gatewayUrl);
    const parameters = createEpayQueryParameters(
      credentials.merchantId,
      attempt.merchantOrderNo,
      credentials.merchantKey,
    );
    url.search = new URLSearchParams(parameters).toString();
    const timeoutMs = this.integerFromEnv(
      'EPAY_RECONCILIATION_REQUEST_TIMEOUT_MS',
      8_000,
      1_000,
      30_000,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('易支付查单请求失败');
    }
    if (!response.ok) {
      throw new Error(`易支付查单返回 HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > RESPONSE_LIMIT_BYTES) {
      throw new Error('易支付查单响应过大');
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > RESPONSE_LIMIT_BYTES) {
      throw new Error('易支付查单响应过大');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error('易支付查单响应不是有效 JSON');
    }
    return parseEpayQueryResponse(
      payload,
      {
        merchantOrderNo: attempt.merchantOrderNo,
        paymentType: attempt.paymentType,
        amountCents: attempt.amountCents,
      },
      credentials.merchantKey,
    );
  }

  private async paymentCredentials(attempt: QueryablePaymentAttempt) {
    const snapshots = [
      attempt.gatewayUrlSnapshot,
      attempt.merchantIdSnapshot,
      attempt.merchantKeyCiphertext,
    ];
    if (snapshots.some(Boolean)) {
      if (!snapshots.every(Boolean)) {
        throw new Error('易支付订单查单配置快照不完整');
      }
      let merchantKey: string | undefined;
      try {
        merchantKey = this.cipher.decrypt(attempt.merchantKeyCiphertext);
      } catch {
        throw new Error('易支付订单密钥快照无法解密');
      }
      if (!merchantKey) throw new Error('易支付订单密钥快照为空');
      return {
        gatewayUrl: attempt.gatewayUrlSnapshot!,
        merchantId: attempt.merchantIdSnapshot!,
        merchantKey,
      };
    }

    const current = await this.settings.getEpayConfig();
    if (!current.gatewayUrl || !current.merchantId || !current.merchantKey) {
      throw new Error('旧易支付订单缺少当前查单配置');
    }
    return {
      gatewayUrl: current.gatewayUrl,
      merchantId: current.merchantId,
      merchantKey: current.merchantKey,
    };
  }

  private testCredentials(attempt: QueryableGatewayTestAttempt) {
    let merchantKey: string | undefined;
    try {
      merchantKey = this.cipher.decrypt(attempt.merchantKeyCiphertext);
    } catch {
      throw new Error('易支付测试单密钥快照无法解密');
    }
    if (!merchantKey) throw new Error('易支付测试单缺少商户密钥');
    return {
      gatewayUrl: attempt.gatewayUrlSnapshot,
      merchantId: attempt.merchantIdSnapshot,
      merchantKey,
    };
  }

  private markPaymentQueried(id: string) {
    return this.prisma.epayPaymentAttempt.updateMany({
      where: { id },
      data: { lastQueryAt: new Date(), lastQueryError: null },
    });
  }

  private markTestQueried(id: string) {
    return this.prisma.epayGatewayTestAttempt.updateMany({
      where: { id },
      data: { lastQueryAt: new Date(), lastQueryError: null },
    });
  }

  private async closePayment(attempt: QueryablePaymentAttempt) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.epayPaymentAttempt.updateMany({
        where: { id: attempt.id, status: { not: EpayPaymentStatus.SETTLED } },
        data: {
          status: EpayPaymentStatus.FAILED,
          activeKey: null,
          failedAt: now,
          closedAt: now,
          lastQueryAt: now,
          lastQueryError: null,
        },
      });
      if (updated.count > 0) {
        await tx.auditLog.create({
          data: {
            action: 'EPAY_QUERY_CLOSED',
            targetType: 'EpayPaymentAttempt',
            targetId: attempt.id,
            metadata: { merchantOrderNo: attempt.merchantOrderNo },
          },
        });
      }
    });
  }

  private async closeGatewayTest(attempt: QueryableGatewayTestAttempt) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.epayGatewayTestAttempt.updateMany({
        where: { id: attempt.id, status: { not: EpayPaymentStatus.SETTLED } },
        data: {
          status: EpayPaymentStatus.FAILED,
          activeKey: null,
          closedAt: now,
          lastQueryAt: now,
          lastQueryError: null,
        },
      });
      if (updated.count > 0) {
        await tx.auditLog.create({
          data: {
            action: 'EPAY_TEST_QUERY_CLOSED',
            targetType: 'EpayGatewayTestAttempt',
            targetId: attempt.id,
            metadata: { merchantOrderNo: attempt.merchantOrderNo },
          },
        });
      }
    });
  }

  private recordPaymentQueryFailure(id: string, error: unknown) {
    return this.prisma.epayPaymentAttempt.updateMany({
      where: { id, status: { not: EpayPaymentStatus.SETTLED } },
      data: {
        lastQueryAt: new Date(),
        queryFailureCount: { increment: 1 },
        lastQueryError: this.describeQueryError(error),
      },
    });
  }

  private recordTestQueryFailure(id: string, error: unknown) {
    return this.prisma.epayGatewayTestAttempt.updateMany({
      where: { id, status: { not: EpayPaymentStatus.SETTLED } },
      data: {
        lastQueryAt: new Date(),
        queryFailureCount: { increment: 1 },
        lastQueryError: this.describeQueryError(error),
      },
    });
  }

  private describeQueryError(error: unknown) {
    return (error instanceof Error ? error.message : '未知查单错误').slice(
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
      ? Math.min(Math.max(value, minimum), maximum)
      : fallback;
  }
}
