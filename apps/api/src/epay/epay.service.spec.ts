import {
  BillingPeriod,
  CatalogProductKind,
  EpayPaymentStatus,
} from '@prisma/client';
import { EpayService } from './epay.service';
import { createEpaySignature } from './epay-signature';

describe('EpayService callbacks', () => {
  const cipher = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
    decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
  };
  const config = {
    checkoutMode: 'store' as const,
    gatewayUrl: 'https://pay.test',
    merchantId: '1001',
    merchantKey: 'merchant-secret',
    paymentType: 'alipay' as const,
    configured: true,
  };

  function callback(overrides: Record<string, string> = {}) {
    const parameters = {
      pid: '1001',
      type: 'alipay',
      out_trade_no: 'EP202608290001',
      trade_no: 'gateway-1',
      money: '12.30',
      name: 'Spark · 月付',
      trade_status: 'TRADE_SUCCESS',
      sign_type: 'MD5',
      ...overrides,
    };
    return {
      ...parameters,
      sign: createEpaySignature(parameters, config.merchantKey),
    };
  }

  function testCallback(overrides: Record<string, string> = {}) {
    const parameters = {
      pid: '1001',
      type: 'alipay',
      out_trade_no: 'EPT202609010001',
      trade_no: 'gateway-test-1',
      money: '0.01',
      name: '易支付通道测试（不发放商品）',
      trade_status: 'TRADE_SUCCESS',
      sign_type: 'MD5',
      ...overrides,
    };
    return {
      ...parameters,
      sign: createEpaySignature(parameters, config.merchantKey),
    };
  }

  it('creates and signs a payment with the payment method selected by the member', async () => {
    const offer = {
      id: 'offer_1',
      slug: 'spark-monthly',
      name: 'Spark · 月付',
      billingPeriod: BillingPeriod.MONTHLY,
      intervalMonths: 1,
      trafficBytes: BigInt(100 * 1024 * 1024 * 1024),
      priceCents: 1230,
      currency: 'CNY',
      archivedAt: null,
      productId: 'product_1',
      legacyPlanOfferId: null,
      legacyPlanOffer: null,
      product: {
        id: 'product_1',
        slug: 'spark',
        name: 'Spark',
        kind: CatalogProductKind.PLAN,
        accessProfileId: 'profile_1',
        accessProfile: {
          speedUpMbps: 20,
          speedDownMbps: 120,
          deviceLimit: 100,
        },
        defaultTrafficMultiplierBasisPoints: 10000,
        requiresActivePlan: false,
        purchaseLimitPerUser: null,
        purchaseLimitKey: null,
        legacyPlanId: null,
        legacyPlan: null,
        legacyTrafficPackProductId: null,
      },
    };
    let createdData: Record<string, unknown> | undefined;
    const tx = {
      epayPaymentAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return Promise.resolve({
            ...data,
            id: 'attempt_1',
            status: EpayPaymentStatus.PENDING,
            orderId: null,
            settlementFailureCount: 0,
          });
        }),
      },
      catalogOffer: { findUnique: jest.fn().mockResolvedValue(offer) },
    };
    const prisma = {
      catalogOffer: { findUnique: jest.fn().mockResolvedValue(offer) },
      epayPaymentAttempt: { findFirst: jest.fn() },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const service = new EpayService(
      prisma as never,
      {
        getEpayConfig: jest.fn().mockResolvedValue({
          ...config,
          checkoutMode: 'epay',
        }),
      } as never,
      {
        quoteCheckout: jest.fn().mockResolvedValue({
          productName: 'Spark · 月付',
          basePriceCents: 1230,
          finalPriceCents: 1230,
        }),
      } as never,
      cipher as never,
    );

    await expect(
      service.createPayment('user_1', 'offer_1', 'key_1', undefined, 'wxpay'),
    ).resolves.toMatchObject({
      gateway: {
        url: 'https://pay.test/submit.php',
        fields: { type: 'wxpay' },
      },
    });
    expect(createdData?.paymentType).toBe('wxpay');
  });

  it('creates a one-cent gateway test without creating a commerce order', async () => {
    let createdData: Record<string, unknown> | undefined;
    const tx = {
      epayGatewayTestAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return Promise.resolve({
            ...data,
            id: 'test_1',
            status: EpayPaymentStatus.PENDING,
            settledAt: null,
          });
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const commerce = { fulfillEpayPayment: jest.fn() };
    const settings = {
      getEpayConfig: jest.fn().mockResolvedValue({
        ...config,
        gatewayUrl: 'https://ai.haiy.space/api/v1/payment-proxy/submit',
      }),
      epayConfigFingerprint: jest.fn().mockReturnValue('fingerprint_1'),
    };
    const service = new EpayService(
      prisma as never,
      settings as never,
      commerce as never,
      cipher as never,
    );

    const result = await service.createGatewayTest('admin_1', 'alipay');
    expect(result).toMatchObject({
      amountCents: 1,
      gateway: {
        url: 'https://ai.haiy.space/api/v1/payment-proxy/submit',
        fields: {
          money: '0.01',
        },
      },
    });
    if (!('gateway' in result)) throw new Error('Gateway form missing');
    expect(result.gateway.fields.notify_url).toContain(
      '/api/payments/epay/test-notify',
    );
    expect(result.gateway.fields.return_url).toContain(
      '/api/payments/epay/test-return',
    );
    expect(createdData).toMatchObject({
      requestedById: 'admin_1',
      configFingerprint: 'fingerprint_1',
      amountCents: 1,
    });
    expect(commerce.fulfillEpayPayment).not.toHaveBeenCalled();
  });

  it('reports Alipay and WeChat tests independently', async () => {
    const now = new Date('2026-09-01T08:00:00.000Z');
    const attempts = {
      fp_alipay: {
        id: 'test_alipay',
        status: EpayPaymentStatus.SETTLED,
        paymentType: 'alipay',
        amountCents: 1,
        createdAt: now,
        settledAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      fp_wxpay: {
        id: 'test_wxpay',
        status: EpayPaymentStatus.PENDING,
        paymentType: 'wxpay',
        amountCents: 1,
        createdAt: now,
        settledAt: null,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    };
    const prisma = {
      epayGatewayTestAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn((input: { where: { configFingerprint: string } }) =>
          Promise.resolve(
            attempts[input.where.configFingerprint as keyof typeof attempts] ??
              null,
          ),
        ),
      },
    };
    const settings = {
      getEpayConfig: jest.fn().mockResolvedValue(config),
      epayConfigFingerprint: jest.fn(
        ({ paymentType }: { paymentType: string }) => `fp_${paymentType}`,
      ),
    };
    const service = new EpayService(
      prisma as never,
      settings as never,
      {} as never,
      cipher as never,
    );

    await expect(service.latestGatewayTest()).resolves.toMatchObject({
      configured: true,
      tested: false,
      channels: {
        alipay: { tested: true, status: 'settled' },
        wxpay: { tested: false, status: 'pending' },
      },
    });
  });

  it('settles a gateway test callback without creating an order or entitlement', async () => {
    const attempt = {
      id: 'test_1',
      requestedById: 'admin_1',
      merchantOrderNo: 'EPT202609010001',
      gatewayTradeNo: null as string | null,
      activeKey: 'admin_1:fingerprint_1:alipay',
      status: EpayPaymentStatus.PENDING,
      paymentType: 'alipay',
      merchantIdSnapshot: '1001',
      merchantKeyCiphertext: 'enc:merchant-secret',
      amountCents: 1,
    };
    const tx = {
      epayGatewayTestAttempt: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(attempt)),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(attempt, data);
          return Promise.resolve(attempt);
        }),
      },
    };
    const prisma = {
      epayGatewayTestAttempt: {
        findUnique: jest.fn().mockResolvedValue(attempt),
      },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const commerce = { fulfillEpayPayment: jest.fn() };
    const service = new EpayService(
      prisma as never,
      {} as never,
      commerce as never,
      cipher as never,
    );

    await expect(
      service.processGatewayTestCallback(testCallback()),
    ).resolves.toMatchObject({
      accepted: true,
      attemptId: 'test_1',
      status: 'success',
    });
    expect(attempt.status).toBe(EpayPaymentStatus.SETTLED);
    expect(commerce.fulfillEpayPayment).not.toHaveBeenCalled();
  });

  it('settles repeated callbacks exactly once after switching back to store mode', async () => {
    const attempt = {
      id: 'attempt_1',
      userId: 'user_1',
      offerId: 'offer_1',
      orderId: null as string | null,
      merchantOrderNo: 'EP202608290001',
      gatewayTradeNo: null as string | null,
      status: EpayPaymentStatus.PENDING,
      paymentType: 'alipay',
      merchantIdSnapshot: '1001',
      merchantKeyCiphertext: 'enc:merchant-secret',
      amountCents: 1230,
      basePriceCents: 1230,
      productNameSnapshot: 'Spark · 月付',
      settlementFailureCount: 0,
      expiresAt: new Date('2026-08-29T01:00:00.000Z'),
    };
    const tx = {
      epayPaymentAttempt: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(attempt)),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(attempt, data);
          return Promise.resolve(attempt);
        }),
      },
    };
    const prisma = {
      epayPaymentAttempt: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(attempt)),
      },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const commerce = {
      fulfillEpayPayment: jest.fn().mockResolvedValue({ orderId: 'order_1' }),
    };
    const settings = { getEpayConfig: jest.fn().mockResolvedValue(config) };
    const service = new EpayService(
      prisma as never,
      settings as never,
      commerce as never,
      cipher as never,
    );

    await expect(service.processCallback(callback())).resolves.toMatchObject({
      accepted: true,
      attemptId: 'attempt_1',
      status: 'success',
    });
    await expect(service.processCallback(callback())).resolves.toMatchObject({
      accepted: true,
      attemptId: 'attempt_1',
      status: 'success',
    });

    expect(commerce.fulfillEpayPayment).toHaveBeenCalledTimes(1);
    expect(attempt.orderId).toBe('order_1');
    expect(attempt.status).toBe(EpayPaymentStatus.SETTLED);
  });

  it('rejects a validly signed callback when its amount differs from the order', async () => {
    const tx = {
      epayPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attempt_1',
          merchantOrderNo: 'EP202608290001',
          paymentType: 'alipay',
          amountCents: 1230,
          status: EpayPaymentStatus.PENDING,
        }),
      },
    };
    const prisma = {
      epayPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attempt_1',
          merchantOrderNo: 'EP202608290001',
          paymentType: 'alipay',
          merchantIdSnapshot: '1001',
          merchantKeyCiphertext: 'enc:merchant-secret',
          amountCents: 1230,
          status: EpayPaymentStatus.PENDING,
        }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const commerce = { fulfillEpayPayment: jest.fn() };
    const service = new EpayService(
      prisma as never,
      { getEpayConfig: jest.fn().mockResolvedValue(config) } as never,
      commerce as never,
      cipher as never,
    );

    await expect(
      service.processCallback(callback({ money: '12.31' })),
    ).resolves.toEqual({ accepted: false, status: 'failed' });
    expect(commerce.fulfillEpayPayment).not.toHaveBeenCalled();
  });

  it('rejects invalid merchant IDs, statuses, and signatures before starting settlement', async () => {
    const prisma = {
      epayPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attempt_1',
          merchantIdSnapshot: '1001',
          merchantKeyCiphertext: 'enc:merchant-secret',
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new EpayService(
      prisma as never,
      { getEpayConfig: jest.fn().mockResolvedValue(config) } as never,
      {} as never,
      cipher as never,
    );

    const badPid = callback({ pid: 'other' });
    const badStatus = callback({ trade_status: 'WAIT_BUYER_PAY' });
    const badSignature = { ...callback(), sign: '0'.repeat(32) };
    for (const parameters of [badPid, badStatus, badSignature]) {
      await expect(service.processCallback(parameters)).resolves.toEqual({
        accepted: false,
        status: 'failed',
      });
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses the attempt credential snapshot after merchant settings rotate', async () => {
    const attempt = {
      id: 'attempt_1',
      userId: 'user_1',
      offerId: 'offer_1',
      orderId: null,
      merchantOrderNo: 'EP202608290001',
      gatewayTradeNo: null,
      status: EpayPaymentStatus.PENDING,
      paymentType: 'alipay',
      merchantIdSnapshot: '1001',
      merchantKeyCiphertext: 'enc:merchant-secret',
      amountCents: 1230,
      basePriceCents: 1230,
      productNameSnapshot: 'Spark · 月付',
      settlementFailureCount: 0,
      expiresAt: new Date('2026-08-29T01:00:00.000Z'),
    };
    const tx = {
      epayPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(attempt),
        update: jest.fn().mockResolvedValue({
          ...attempt,
          orderId: 'order_1',
          gatewayTradeNo: 'gateway-1',
          status: EpayPaymentStatus.SETTLED,
        }),
      },
    };
    const prisma = {
      epayPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(attempt) },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const settings = {
      getEpayConfig: jest.fn().mockResolvedValue({
        ...config,
        merchantId: '2002',
        merchantKey: 'rotated-secret',
      }),
    };
    const service = new EpayService(
      prisma as never,
      settings as never,
      {
        fulfillEpayPayment: jest.fn().mockResolvedValue({ orderId: 'order_1' }),
      } as never,
      cipher as never,
    );

    await expect(service.processCallback(callback())).resolves.toMatchObject({
      accepted: true,
      status: 'success',
    });
    expect(settings.getEpayConfig).not.toHaveBeenCalled();
  });

  it('records a verified payment when entitlement fulfillment fails', async () => {
    const attempt = {
      id: 'attempt_1',
      userId: 'user_1',
      offerId: 'offer_1',
      merchantOrderNo: 'EP202608290001',
      gatewayTradeNo: null,
      status: EpayPaymentStatus.PENDING,
      paymentType: 'alipay',
      merchantIdSnapshot: '1001',
      merchantKeyCiphertext: 'enc:merchant-secret',
      amountCents: 1230,
      basePriceCents: 1230,
      entitlementSnapshot: null,
    };
    type FailureUpdateInput = {
      data: { settlementFailureCount?: { increment: number } };
    };
    let failureUpdate: FailureUpdateInput | undefined;
    const updateMany = jest.fn((input: FailureUpdateInput) => {
      failureUpdate = input;
      return Promise.resolve({ count: 1 });
    });
    const tx = {
      epayPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(attempt),
        updateMany,
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      epayPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(attempt) },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const service = new EpayService(
      prisma as never,
      { getEpayConfig: jest.fn() } as never,
      {
        fulfillEpayPayment: jest
          .fn()
          .mockRejectedValue(new Error('No serviceable node')),
      } as never,
      cipher as never,
    );

    await expect(service.processCallback(callback())).resolves.toEqual({
      accepted: false,
      attemptId: 'attempt_1',
      status: 'failed',
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(failureUpdate?.data.settlementFailureCount).toEqual({
      increment: 1,
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
