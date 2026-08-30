import { EpayPaymentStatus } from '@prisma/client';
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
