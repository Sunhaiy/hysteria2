import { EpayPaymentStatus } from '@prisma/client';
import { createEpaySignature, type EpayParameters } from './epay-signature';
import { EpayReconciliationService } from './epay-reconciliation.service';

describe('EpayReconciliationService', () => {
  type UpdateManyInput = {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  const merchantKey = 'merchant-secret';
  const baseAttempt = {
    id: 'attempt_1',
    userId: 'user_1',
    offerId: 'offer_1',
    orderId: null,
    merchantOrderNo: 'EP202609010001',
    gatewayTradeNo: null,
    idempotencyKey: 'key_1',
    activeKey: 'user_1:product_1',
    status: EpayPaymentStatus.PENDING,
    paymentType: 'alipay',
    gatewayUrlSnapshot: 'https://ai.haiy.space/api/v1/payment-proxy/submit',
    merchantIdSnapshot: '1001',
    merchantKeyCiphertext: 'enc:merchant-secret',
    amountCents: 1290,
    basePriceCents: 1290,
    currency: 'CNY',
    productNameSnapshot: 'Pro · 月付',
    entitlementSnapshot: null,
    settlementFailureCount: 0,
    lastSettlementError: null,
    lastSettlementFailedAt: null,
    lastQueryAt: null,
    queryFailureCount: 0,
    lastQueryError: null,
    closedAt: null,
    expiresAt: new Date('2026-09-01T01:00:00.000Z'),
    settledAt: null,
    failedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const cipher = {
    decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
  };

  function response(overrides: EpayParameters = {}) {
    const parameters: EpayParameters = {
      code: '1',
      msg: 'success',
      status: '1',
      trade_status: 'TRADE_SUCCESS',
      trade_no: 'gateway-1',
      out_trade_no: baseAttempt.merchantOrderNo,
      type: baseAttempt.paymentType,
      money: '12.90',
      sign_type: 'MD5',
      ...overrides,
    };
    return {
      ...parameters,
      sign: createEpaySignature(parameters, merchantKey),
    };
  }

  function setup(
    payload: unknown,
    fetchError = false,
    attemptOverrides: Omit<
      Partial<typeof baseAttempt>,
      'merchantKeyCiphertext'
    > & { merchantKeyCiphertext?: string | null } = {},
  ) {
    const paymentFindMany = jest.fn(
      (input: { where: Record<string, unknown> }) => {
        void input;
        return Promise.resolve([{ ...baseAttempt, ...attemptOverrides }]);
      },
    );
    const paymentUpdates: UpdateManyInput[] = [];
    const paymentUpdateMany = jest.fn((input: UpdateManyInput) => {
      paymentUpdates.push(input);
      return Promise.resolve({ count: 1 });
    });
    const tx = {
      epayPaymentAttempt: { updateMany: paymentUpdateMany },
      epayGatewayTestAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      epayPaymentAttempt: {
        findMany: paymentFindMany,
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...baseAttempt, ...attemptOverrides }),
        updateMany: paymentUpdateMany,
      },
      epayGatewayTestAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const epay = {
      settleVerifiedPayment: jest.fn().mockResolvedValue({
        accepted: true,
        attemptId: baseAttempt.id,
        status: 'success',
      }),
      settleVerifiedGatewayTest: jest.fn(),
    };
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() =>
      fetchError
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve(
            new Response(JSON.stringify(payload), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ),
    );
    const service = new EpayReconciliationService(
      prisma as never,
      epay as never,
      cipher as never,
    );
    return {
      service,
      prisma,
      epay,
      tx,
      fetchMock,
      paymentUpdateMany,
      paymentUpdates,
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queries with signed parameters and settles a verified paid order', async () => {
    const { service, epay, fetchMock, prisma } = setup(response());

    await expect(service.reconcileDueAttempts()).resolves.toMatchObject({
      checked: 1,
      settled: 1,
      failed: 0,
    });
    expect(epay.settleVerifiedPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: baseAttempt.merchantOrderNo,
        gatewayTradeNo: 'gateway-1',
        amountCents: 1290,
        paymentType: 'alipay',
      }),
    );
    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (!(requestUrl instanceof URL)) throw new Error('Expected a URL request');
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      'https://ai.haiy.space/api/v1/payment-proxy/query',
    );
    expect(requestUrl.searchParams.get('pid')).toBe('1001');
    expect(requestUrl.searchParams.get('out_trade_no')).toBe(
      baseAttempt.merchantOrderNo,
    );
    expect(requestUrl.searchParams.get('sign')).toBeTruthy();
    const findRequest = prisma.epayPaymentAttempt.findMany.mock.calls[0]?.[0];
    expect(findRequest.where.createdAt).not.toHaveProperty('gte');
  });

  it('allows an administrator to reconcile one old payment attempt on demand', async () => {
    const oldAttempt = {
      ...baseAttempt,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const { service, epay } = setup(response(), false, oldAttempt);

    await expect(
      service.reconcilePaymentAttempt(baseAttempt.id),
    ).resolves.toEqual({
      attemptId: baseAttempt.id,
      outcome: 'settled',
    });
    expect(epay.settleVerifiedPayment).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid pending order unsettled and records the query time', async () => {
    const { service, epay, paymentUpdates } = setup(
      response({ status: '0', trade_status: 'PENDING', trade_no: '' }),
    );

    await expect(service.reconcileDueAttempts()).resolves.toMatchObject({
      pending: 1,
    });
    expect(epay.settleVerifiedPayment).not.toHaveBeenCalled();
    const update = paymentUpdates.at(-1) as unknown as
      | { data: { lastQueryError?: string | null } }
      | undefined;
    expect(update?.data.lastQueryError).toBeNull();
  });

  it('closes an expired order that the gateway confirms does not exist', async () => {
    const { service, epay, paymentUpdates } = setup(
      response({
        code: '-1',
        msg: 'not found',
        status: '0',
        trade_status: 'CLOSED',
        trade_no: '',
      }),
    );

    await expect(service.reconcileDueAttempts()).resolves.toMatchObject({
      closed: 1,
      notFound: 0,
    });
    expect(epay.settleVerifiedPayment).not.toHaveBeenCalled();
    expect(paymentUpdates.at(-1)?.data).toMatchObject({
      status: EpayPaymentStatus.FAILED,
      activeKey: null,
    });
  });

  it('closes a signed closed order and releases its active purchase key', async () => {
    const { service, tx, epay, paymentUpdates } = setup(
      response({ status: '0', trade_status: 'CLOSED', trade_no: '' }),
    );

    await expect(service.reconcileDueAttempts()).resolves.toMatchObject({
      closed: 1,
    });
    expect(epay.settleVerifiedPayment).not.toHaveBeenCalled();
    const update = paymentUpdates.at(-1) as unknown as
      | { data: { status?: EpayPaymentStatus; activeKey?: string | null } }
      | undefined;
    expect(update?.data).toMatchObject({
      status: EpayPaymentStatus.FAILED,
      activeKey: null,
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('never settles a bad signature and records a bounded query failure', async () => {
    const { service, epay, paymentUpdates } = setup({
      ...response(),
      sign: '0'.repeat(32),
    });

    await expect(service.reconcileDueAttempts()).resolves.toMatchObject({
      failed: 1,
    });
    expect(epay.settleVerifiedPayment).not.toHaveBeenCalled();
    const update = paymentUpdates.at(-1) as unknown as
      | {
          data: {
            queryFailureCount?: { increment: number };
            lastQueryError?: string;
          };
        }
      | undefined;
    expect(update?.data).toMatchObject({
      queryFailureCount: { increment: 1 },
      lastQueryError: '易支付查单响应签名无效',
    });
  });

  it('records network failures without leaking the signed query URL', async () => {
    const { service, paymentUpdates } = setup({}, true);

    await expect(service.reconcileDueAttempts()).resolves.toMatchObject({
      failed: 1,
    });
    const update = paymentUpdates.at(-1) as unknown as
      | { data: { lastQueryError?: string } }
      | undefined;
    expect(update?.data.lastQueryError).toBe('易支付查单请求失败');
  });

  it('sends an incomplete credential snapshot to manual review without querying', async () => {
    const { service, fetchMock, paymentUpdates } = setup({}, false, {
      merchantKeyCiphertext: null,
    });

    await expect(service.reconcileDueAttempts()).resolves.toMatchObject({
      failed: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const update = paymentUpdates.at(-1) as unknown as
      | { data: { lastQueryError?: string } }
      | undefined;
    expect(update?.data).toMatchObject({
      activeKey: null,
      fulfillmentStatus: 'MANUAL_REVIEW',
      lastQueryError: '易支付订单缺少完整的不可变凭据快照，必须人工处理',
    });
  });

  it('reconciles a paid gateway test without creating customer fulfillment', async () => {
    const testAttempt = {
      id: 'test_1',
      requestedById: 'admin_1',
      merchantOrderNo: 'EPT202609010001',
      gatewayTradeNo: null,
      activeKey: 'admin_1:fingerprint:wxpay',
      status: EpayPaymentStatus.PENDING,
      paymentType: 'wxpay',
      gatewayUrlSnapshot: 'https://ai.haiy.space/api/v1/payment-proxy/submit',
      merchantIdSnapshot: '1001',
      merchantKeyCiphertext: 'enc:merchant-secret',
      configFingerprint: 'fingerprint',
      amountCents: 1,
      lastQueryAt: null,
      queryFailureCount: 0,
      lastQueryError: null,
      closedAt: null,
      expiresAt: new Date('2026-09-01T01:00:00.000Z'),
      settledAt: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    };
    const responseParameters: EpayParameters = {
      code: '1',
      msg: 'success',
      status: '1',
      trade_status: 'TRADE_SUCCESS',
      trade_no: 'gateway-test-1',
      out_trade_no: testAttempt.merchantOrderNo,
      type: 'wxpay',
      money: '0.01',
      sign_type: 'MD5',
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ...responseParameters,
          sign: createEpaySignature(responseParameters, merchantKey),
        }),
        { status: 200 },
      ),
    );
    const prisma = {
      epayPaymentAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      epayGatewayTestAttempt: {
        findMany: jest.fn().mockResolvedValue([testAttempt]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const epay = {
      settleVerifiedPayment: jest.fn(),
      settleVerifiedGatewayTest: jest.fn().mockResolvedValue({
        accepted: true,
        attemptId: testAttempt.id,
        status: 'success',
      }),
    };
    const service = new EpayReconciliationService(
      prisma as never,
      epay as never,
      cipher as never,
    );

    await expect(service.reconcileDueAttempts()).resolves.toMatchObject({
      checked: 1,
      settled: 1,
    });
    expect(epay.settleVerifiedGatewayTest).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: testAttempt.merchantOrderNo,
        gatewayTradeNo: 'gateway-test-1',
        amountCents: 1,
        paymentType: 'wxpay',
      }),
    );
    expect(epay.settleVerifiedPayment).not.toHaveBeenCalled();
  });
});
