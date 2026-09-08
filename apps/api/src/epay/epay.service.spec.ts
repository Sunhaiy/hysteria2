import {
  BillingPeriod,
  CatalogProductKind,
  EpayPaymentStatus,
  Prisma,
} from '@prisma/client';
import { EpayService } from './epay.service';
import { createEpaySignature } from './epay-signature';
import { PaymentFulfillmentRejectedError } from '../commerce/payment-fulfillment.error';

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

  it('creates and signs a plan reset with an isolated active key and entitlement snapshot', async () => {
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
        series: 'STANDARD',
        quotaCadence: 'MONTHLY_RESET',
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
    const expirationUpdateMany = jest.fn(
      (input: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        void input;
        return Promise.resolve({ count: 0 });
      },
    );
    const tx = {
      epayPaymentAttempt: {
        updateMany: expirationUpdateMany,
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
    const checkout = {
      prepare: jest.fn(
        (gateway: {
          url: string;
          method: 'POST';
          fields: Record<string, string>;
        }) =>
          Promise.resolve({
            ...gateway,
            url: 'https://direct-pay.test/session',
            method: 'GET' as const,
            fields: {},
          }),
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
          productName: 'Spark · 本期流量重置',
          basePriceCents: 1230,
          finalPriceCents: 861,
          purchaseMode: 'plan_reset',
          resetGrantId: 'grant_1',
          resetBucketId: 'bucket_1',
          resetCycleStartsAt: '2026-09-01T00:00:00.000Z',
          resetCycleEndsAt: '2026-10-01T00:00:00.000Z',
          resetTrafficBytes: String(100 * 1024 * 1024 * 1024),
          resetCreditBytes: String(90 * 1024 * 1024 * 1024),
        }),
      } as never,
      cipher as never,
      checkout as never,
    );

    await expect(
      service.createPayment(
        'user_1',
        'offer_1',
        'key_1',
        undefined,
        'wxpay',
        'plan_reset',
      ),
    ).resolves.toMatchObject({
      gateway: {
        url: 'https://direct-pay.test/session',
        method: 'GET',
      },
    });
    expect(checkout.prepare).toHaveBeenCalledTimes(1);
    expect(checkout.prepare.mock.calls[0]?.[0].fields.type).toBe('wxpay');
    expect(createdData?.paymentType).toBe('wxpay');
    expect(createdData?.activeKey).toBe('user_1:product_1:plan_reset');
    expect(createdData?.amountCents).toBe(861);
    expect(createdData?.entitlementSnapshot).toMatchObject({
      purchaseMode: 'plan_reset',
      resetGrantId: 'grant_1',
      resetBucketId: 'bucket_1',
      resetCycleStartsAt: '2026-09-01T00:00:00.000Z',
      resetCycleEndsAt: '2026-10-01T00:00:00.000Z',
      resetTrafficBytes: String(100 * 1024 * 1024 * 1024),
      resetCreditBytes: String(90 * 1024 * 1024 * 1024),
    });
    const expirationUpdate = expirationUpdateMany.mock.calls[0]?.[0];
    expect(expirationUpdate).toBeDefined();
    if (!expirationUpdate) throw new Error('Expected an expiration update');
    expect(expirationUpdate.data).toMatchObject({ activeKey: null });
  });

  it('ignores an activation preference when the server resolves a same-plan renewal', async () => {
    const offer = {
      id: 'offer_start_monthly',
      priceCents: 1_290,
      currency: 'CNY',
      archivedAt: null,
      productId: 'product_start',
      product: {
        kind: CatalogProductKind.PLAN,
        series: 'STANDARD',
        purchaseLimitKey: null,
      },
    };
    const entitlementSnapshot = {
      version: 2,
      offerId: offer.id,
      offerSlug: 'start-monthly',
      offerName: '月付',
      productId: 'product_start',
      productSlug: 'start',
      productName: 'Start',
      productKind: CatalogProductKind.PLAN,
      productSeries: 'STANDARD',
      quotaCadence: 'MONTHLY_RESET',
      billingPeriod: BillingPeriod.MONTHLY,
      intervalMonths: 1,
      legacyDurationDays: null,
      trafficBytes: String(100 * 1024 ** 3),
      currency: 'CNY',
      accessProfileId: 'profile_start',
      speedUpMbps: 20,
      speedDownMbps: 120,
      deviceLimit: 100,
      trafficMultiplierBasisPoints: 10_000,
      requiresActivePlan: false,
      purchaseLimitPerUser: null,
      purchaseLimitKey: null,
      legacyPlanId: 'plan_start',
      legacyPlanOfferId: 'plan_offer_start_monthly',
      legacyTrafficPackProductId: null,
      purchaseMode: 'initial',
      planActivationPreference: null,
      planActivationMode: 'renewal',
      planEffectiveAt: '2026-10-07T00:00:00.000Z',
    };
    const replay = {
      id: 'attempt-renewal',
      offerId: offer.id,
      paymentType: 'alipay',
      merchantOrderNo: 'EP-RENEWAL',
      status: EpayPaymentStatus.SETTLED,
      fulfillmentStatus: 'APPLIED',
      gatewayUrlSnapshot: config.gatewayUrl,
      merchantIdSnapshot: config.merchantId,
      merchantKeyCiphertext: 'enc:merchant-secret',
      amountCents: 1_290,
      productNameSnapshot: 'Start · 月付',
      expiresAt: new Date('2026-09-07T01:00:00.000Z'),
      orderId: 'order-renewal',
      settlementFailureCount: 0,
      entitlementSnapshot,
    };
    const tx = {
      epayPaymentAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(replay),
      },
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
          productName: 'Start · 月付',
          basePriceCents: 1_290,
          finalPriceCents: 1_290,
          purchaseMode: 'initial',
          planActivationMode: 'renewal',
          planEffectiveAt: '2026-10-07T00:00:00.000Z',
        }),
      } as never,
      cipher as never,
    );

    await expect(
      service.createPayment(
        'user_1',
        offer.id,
        'renewal-key',
        undefined,
        'alipay',
        'purchase',
        'immediate_switch',
      ),
    ).resolves.toMatchObject({
      id: replay.id,
      status: 'settled',
      planActivationMode: 'renewal',
    });
  });

  it('expires a stale payment and releases its group-buy slot when polled', async () => {
    const expiredAt = new Date('2026-09-07T04:00:00.000Z');
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T05:00:00.000Z'));
    const attempt = {
      id: 'attempt-expired',
      userId: 'user-1',
      merchantOrderNo: 'EP-EXPIRED',
      status: EpayPaymentStatus.PENDING,
      activeKey: 'group-buy:member-1',
      amountCents: 1590,
      productNameSnapshot: 'Start · 月付 · 拼团',
      expiresAt: expiredAt,
      orderId: null,
      settlementFailureCount: 0,
    };
    const tx = {
      epayPaymentAttempt: {
        findFirst: jest.fn().mockResolvedValue(attempt),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const groupBuys = { closePayment: jest.fn().mockResolvedValue(undefined) };
    const service = new EpayService(
      prisma as never,
      {} as never,
      {} as never,
      cipher as never,
      undefined,
      groupBuys as never,
    );

    await expect(
      service.getPayment('user-1', attempt.id),
    ).resolves.toMatchObject({ status: 'expired' });
    expect(tx.epayPaymentAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: attempt.id, status: EpayPaymentStatus.PENDING },
      data: { status: EpayPaymentStatus.EXPIRED, activeKey: null },
    });
    expect(groupBuys.closePayment).toHaveBeenCalledWith(tx, attempt.id);
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

  it('retries a serializable group-buy slot conflict before creating payment', async () => {
    const groupBuys = {
      preparePayment: jest.fn().mockResolvedValue({
        group: {
          id: 'group-1',
          offerIdSnapshot: 'offer-1',
          priceCentsSnapshot: 1290,
          currencySnapshot: 'CNY',
        },
        member: { id: 'member-2' },
        offer: { name: '月付', product: { name: 'Start' } },
        existingAttempt: null,
        snapshot: {
          version: 2,
          purchaseMode: 'group_buy',
          groupBuyId: 'group-1',
          groupBuyMemberId: 'member-2',
          groupBuyBonusBytes: String(20 * 1024 ** 3),
          groupBuyOriginalPriceCents: 1590,
          groupBuyPriceCents: 1290,
          groupBuySettlementMode: 'ORIGINAL_PRICE_BALANCE_REBATE',
        },
      }),
      attachPayment: jest.fn(),
      closePayment: jest.fn(),
    };
    const tx = {
      epayPaymentAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...data,
            id: 'attempt-group-1',
            status: EpayPaymentStatus.PENDING,
            orderId: null,
            settlementFailureCount: 0,
          }),
        ),
      },
    };
    const serializationConflict = new Prisma.PrismaClientKnownRequestError(
      'serialization conflict',
      { code: 'P2034', clientVersion: '6.19.3' },
    );
    const prisma = {
      $transaction: jest
        .fn()
        .mockRejectedValueOnce(serializationConflict)
        .mockImplementation(
          (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
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
      {} as never,
      cipher as never,
      undefined,
      groupBuys as never,
    );

    await expect(
      service.createGroupBuyPayment(
        'user-2',
        { kind: 'join', groupId: 'group-1' },
        'alipay',
        'group-idempotency-1',
      ),
    ).resolves.toMatchObject({ id: 'attempt-group-1', status: 'pending' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(groupBuys.preparePayment).toHaveBeenCalledTimes(1);
    expect(groupBuys.attachPayment).toHaveBeenCalledWith(
      tx,
      'member-2',
      'attempt-group-1',
    );
    const groupAttemptInput = tx.epayPaymentAttempt.create.mock.calls[0][0] as {
      data: { amountCents: number; basePriceCents: number };
    };
    expect(groupAttemptInput.data).toMatchObject({
      amountCents: 1590,
      basePriceCents: 1590,
    });
  });

  it('rejects a create replay when the idempotency key belongs to another campaign', async () => {
    const replay = {
      id: 'attempt-old-campaign',
      userId: 'user-1',
      paymentType: 'alipay',
      entitlementSnapshot: {
        version: 2,
        offerId: 'offer-old',
        offerSlug: 'start-monthly',
        offerName: '月付',
        productId: 'product-start',
        productSlug: 'start',
        productName: 'Start',
        productKind: CatalogProductKind.PLAN,
        billingPeriod: BillingPeriod.MONTHLY,
        intervalMonths: 1,
        legacyDurationDays: null,
        trafficBytes: String(100 * 1024 ** 3),
        currency: 'CNY',
        accessProfileId: 'profile-start',
        speedUpMbps: 20,
        speedDownMbps: 120,
        deviceLimit: 100,
        trafficMultiplierBasisPoints: 10_000,
        requiresActivePlan: false,
        purchaseLimitPerUser: null,
        purchaseLimitKey: null,
        legacyPlanId: null,
        legacyPlanOfferId: null,
        legacyTrafficPackProductId: null,
        purchaseMode: 'group_buy',
        groupBuyId: 'group-old',
        groupBuyMemberId: 'member-old',
        groupBuyBonusBytes: String(20 * 1024 ** 3),
        groupBuyOriginalPriceCents: 1590,
        groupBuyPriceCents: 1290,
        groupBuyDiscountBasisPoints: 8113,
        groupBuySettlementMode: 'ORIGINAL_PRICE_BALANCE_REBATE',
      },
    };
    const tx = {
      epayPaymentAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(replay),
      },
      groupBuy: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'group-old', campaignId: 'campaign-old' }),
      },
    };
    const prisma = {
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
      {} as never,
      cipher as never,
      undefined,
      { preparePayment: jest.fn(), closePayment: jest.fn() } as never,
    );

    await expect(
      service.createGroupBuyPayment(
        'user-1',
        { kind: 'create', campaignId: 'campaign-new' },
        'alipay',
        'reused-key',
      ),
    ).rejects.toThrow('Idempotency-Key was already used for another purchase');
  });

  it('rejects a group-buy replay when the frozen activation preference changes', async () => {
    const replay = {
      id: 'attempt-scheduled-switch',
      userId: 'user-1',
      paymentType: 'alipay',
      entitlementSnapshot: {
        version: 2,
        offerId: 'offer-start',
        offerSlug: 'start-monthly',
        offerName: '月付',
        productId: 'product-start',
        productSlug: 'start',
        productName: 'Start',
        productKind: CatalogProductKind.PLAN,
        billingPeriod: BillingPeriod.MONTHLY,
        intervalMonths: 1,
        legacyDurationDays: null,
        trafficBytes: String(100 * 1024 ** 3),
        currency: 'CNY',
        accessProfileId: 'profile-start',
        speedUpMbps: 20,
        speedDownMbps: 120,
        deviceLimit: 100,
        trafficMultiplierBasisPoints: 10_000,
        requiresActivePlan: false,
        purchaseLimitPerUser: null,
        purchaseLimitKey: null,
        legacyPlanId: 'plan-start',
        legacyPlanOfferId: 'plan-offer-start-monthly',
        legacyTrafficPackProductId: null,
        purchaseMode: 'group_buy',
        groupBuyId: 'group-1',
        groupBuyMemberId: 'member-1',
        groupBuyBonusBytes: String(20 * 1024 ** 3),
        groupBuyOriginalPriceCents: 1590,
        groupBuyPriceCents: 1290,
        groupBuyDiscountBasisPoints: 8113,
        groupBuySettlementMode: 'ORIGINAL_PRICE_BALANCE_REBATE',
        planActivationPreference: 'scheduled_switch',
        planActivationMode: 'scheduled_switch',
        planEffectiveAt: '2026-10-07T00:00:00.000Z',
      },
    };
    const tx = {
      epayPaymentAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(replay),
      },
      groupBuy: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'group-1', campaignId: 'campaign-1' }),
      },
    };
    const prisma = {
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
      {} as never,
      cipher as never,
      undefined,
      { preparePayment: jest.fn(), closePayment: jest.fn() } as never,
    );

    await expect(
      service.createGroupBuyPayment(
        'user-1',
        { kind: 'create', campaignId: 'campaign-1' },
        'alipay',
        'reused-key',
        'immediate_switch',
      ),
    ).rejects.toThrow('Idempotency-Key was already used for another purchase');
    expect(tx.groupBuy.findUnique).toHaveBeenCalledTimes(1);
  });

  it('delegates group-buy balance payment before loading 易支付 configuration', async () => {
    const settings = { getEpayConfig: jest.fn() };
    const groupBuys = {
      purchaseWithWallet: jest.fn().mockResolvedValue({
        id: 'balance:member-1',
        status: 'settled',
        paymentType: 'balance',
        amountCents: 1590,
        orderId: 'order-1',
      }),
    };
    const service = new EpayService(
      {} as never,
      settings as never,
      {} as never,
      cipher as never,
      undefined,
      groupBuys as never,
    );

    await expect(
      service.createGroupBuyPayment(
        'user-1',
        { kind: 'create', campaignId: 'campaign-1' },
        'balance',
        'balance-request-1',
        'immediate_switch',
      ),
    ).resolves.toMatchObject({ status: 'settled', paymentType: 'balance' });
    expect(groupBuys.purchaseWithWallet).toHaveBeenCalledWith(
      'user-1',
      { kind: 'create', campaignId: 'campaign-1' },
      'balance-request-1',
      'immediate_switch',
    );
    expect(settings.getEpayConfig).not.toHaveBeenCalled();
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
      gatewayUrlSnapshot: 'https://pay.test',
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

  it('settles a callback and active-query race exactly once after switching back to store mode', async () => {
    const attempt = {
      id: 'attempt_1',
      userId: 'user_1',
      offerId: 'offer_1',
      orderId: null as string | null,
      merchantOrderNo: 'EP202608290001',
      gatewayTradeNo: null as string | null,
      status: EpayPaymentStatus.PENDING,
      paymentType: 'alipay',
      gatewayUrlSnapshot: 'https://pay.test',
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
    let transactionTail = Promise.resolve();
    const prisma = {
      epayPaymentAttempt: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(attempt)),
      },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => {
        const transaction = transactionTail.then(() => work(tx));
        transactionTail = transaction.then(
          () => undefined,
          () => undefined,
        );
        return transaction;
      }),
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

    await expect(
      Promise.all([
        service.processCallback(callback()),
        service.settleVerifiedPayment({
          attemptId: attempt.id,
          merchantOrderNo: attempt.merchantOrderNo,
          gatewayTradeNo: 'gateway-1',
          amountCents: attempt.amountCents,
          paymentType: attempt.paymentType,
          paidAt: new Date('2026-08-29T00:30:00.000Z'),
        }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ accepted: true, status: 'success' }),
      expect.objectContaining({ accepted: true, status: 'success' }),
    ]);

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
          gatewayUrlSnapshot: 'https://pay.test',
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
          gatewayUrlSnapshot: 'https://pay.test',
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
      gatewayUrlSnapshot: 'https://pay.test',
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

  it('never verifies an old callback with current merchant credentials', async () => {
    const attempt = {
      id: 'attempt_without_credentials',
      merchantOrderNo: 'EP202608290001',
      merchantIdSnapshot: null,
      merchantKeyCiphertext: null,
      gatewayUrlSnapshot: null,
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      epayPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(attempt),
        updateMany,
      },
      $transaction: jest.fn(),
    };
    const settings = { getEpayConfig: jest.fn().mockResolvedValue(config) };
    const service = new EpayService(
      prisma as never,
      settings as never,
      {} as never,
      cipher as never,
    );

    await expect(service.processCallback(callback())).resolves.toEqual({
      accepted: false,
      status: 'failed',
    });
    expect(settings.getEpayConfig).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [manualReviewWrite] = updateMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(manualReviewWrite.where).toMatchObject({
      id: attempt.id,
      orderId: null,
    });
    expect(manualReviewWrite.data).toMatchObject({
      activeKey: null,
      fulfillmentStatus: 'MANUAL_REVIEW',
    });
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
      gatewayUrlSnapshot: 'https://pay.test',
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

  it('settles and queues an automatic refund when fulfillment can no longer succeed', async () => {
    const attempt = {
      id: 'attempt-terminal',
      userId: 'user-1',
      offerId: 'offer-1',
      merchantOrderNo: 'EP-TERMINAL',
      gatewayTradeNo: null,
      status: EpayPaymentStatus.PENDING,
      paymentType: 'alipay',
      amountCents: 861,
      basePriceCents: 1230,
      entitlementSnapshot: null,
    };
    const tx = {
      epayPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(attempt),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({
          ...attempt,
          status: EpayPaymentStatus.SETTLED,
          gatewayTradeNo: 'gateway-terminal',
        }),
      },
      epayRefundAttempt: {
        upsert: jest.fn().mockResolvedValue({ id: 'refund-terminal' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const service = new EpayService(
      prisma as never,
      {} as never,
      {
        fulfillEpayPayment: jest
          .fn()
          .mockRejectedValue(
            new PaymentFulfillmentRejectedError(
              'PLAN_RESET_CYCLE_ENDED',
              '流量重置订单已超过原套餐周期',
            ),
          ),
      } as never,
      cipher as never,
    );

    await expect(
      service.settleVerifiedPayment({
        attemptId: attempt.id,
        merchantOrderNo: attempt.merchantOrderNo,
        gatewayTradeNo: 'gateway-terminal',
        amountCents: attempt.amountCents,
        paymentType: attempt.paymentType,
        paidAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      accepted: true,
      attemptId: attempt.id,
      status: 'success',
    });
    const [refundWrite] = tx.epayRefundAttempt.upsert.mock
      .calls[0] as unknown as [
      { where: Record<string, unknown>; create: Record<string, unknown> },
    ];
    expect(refundWrite.where).toEqual({ paymentAttemptId: attempt.id });
    expect(refundWrite.create).toMatchObject({
      paymentAttemptId: attempt.id,
      amountCents: attempt.amountCents,
      reasonCode: 'PLAN_RESET_CYCLE_ENDED',
    });
  });
});
