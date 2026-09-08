import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderQueryService } from './order-query.service';

describe('OrderQueryService', () => {
  it('calculates Shanghai today and month net revenue independently', async () => {
    const orderAggregate = jest
      .fn()
      .mockResolvedValueOnce({
        _sum: { amountCents: 1_500 },
        _count: { _all: 2 },
      })
      .mockResolvedValueOnce({
        _sum: { amountCents: 8_000 },
        _count: { _all: 9 },
      });
    const refundAggregate = jest
      .fn()
      .mockResolvedValueOnce({
        _sum: { amountCents: 200 },
        _count: { _all: 1 },
      })
      .mockResolvedValueOnce({
        _sum: { amountCents: 500 },
        _count: { _all: 2 },
      });
    const service = new OrderQueryService({
      manualOrder: { aggregate: orderAggregate },
      refund: { aggregate: refundAggregate },
    } as never);

    await expect(
      service.summary(new Date('2026-09-01T16:30:00.000Z')),
    ).resolves.toMatchObject({
      today: {
        from: '2026-09-01T16:00:00.000Z',
        netRevenueCents: 1_300,
        orderCount: 2,
      },
      month: {
        from: '2026-08-31T16:00:00.000Z',
        netRevenueCents: 7_500,
        orderCount: 9,
      },
    });
    expect(orderAggregate).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'APPLIED',
        source: 'PAYMENT',
        processedAt: {
          gte: new Date('2026-09-01T16:00:00.000Z'),
          lte: new Date('2026-09-01T16:30:00.000Z'),
        },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
    expect(refundAggregate).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'APPLIED',
        processedAt: {
          gte: new Date('2026-09-01T16:00:00.000Z'),
          lte: new Date('2026-09-01T16:30:00.000Z'),
        },
        order: { source: 'PAYMENT' },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
  });

  it('builds paginated filters without loading orders into memory', async () => {
    const requests: unknown[] = [];
    const findMany = jest.fn((input: unknown) => {
      requests.push(input);
      return Promise.resolve([]);
    });
    const count = jest.fn().mockResolvedValue(0);
    const service = new OrderQueryService({
      manualOrder: { findMany, count },
    } as never);

    await expect(
      service.list({
        q: 'trade-1',
        source: 'payment',
        status: 'applied',
        productKind: 'plan',
        paymentType: 'wxpay',
        from: '2026-09-01',
        to: '2026-09-02',
        page: '2',
        pageSize: '20',
      }),
    ).resolves.toMatchObject({ page: 2, pageSize: 20, total: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    const request = requests[0] as {
      where: Record<string, unknown>;
    };
    expect(request.where).toMatchObject({
      status: 'APPLIED',
      source: 'PAYMENT',
      createdAt: {
        gte: new Date('2026-08-31T16:00:00.000Z'),
        lt: new Date('2026-09-02T16:00:00.000Z'),
      },
    });
  });

  it('rejects invalid filter values and missing order details', async () => {
    const service = new OrderQueryService({
      manualOrder: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as never);

    await expect(service.list({ status: 'paid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.detail('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('releases the active purchase key when the local payment expires', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new OrderQueryService({
      epayPaymentAttempt: {
        updateMany,
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    } as never);

    await expect(service.paymentAttempts()).resolves.toMatchObject({
      total: 0,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'EXPIRED', activeKey: null },
      }),
    );
  });

  it('keeps paid fulfillment failures and compensation refunds in the exception view', async () => {
    const now = new Date('2026-09-07T08:00:00.000Z');
    const refundAttempt = {
      id: 'refund_compensation',
      status: 'PENDING',
      reasonCode: 'ENTITLEMENT_NO_LONGER_AVAILABLE',
      requestCount: 0,
      lastError: null,
      gatewayMessage: null,
      submittedAt: null,
      confirmedAt: null,
    };
    const attempt = {
      id: 'attempt_paid_unfulfilled',
      orderId: null,
      merchantOrderNo: 'EP-COMPENSATE-1',
      gatewayTradeNo: 'gateway-1',
      status: 'SETTLED',
      fulfillmentStatus: 'REFUND_PENDING',
      paymentType: 'alipay',
      amountCents: 1290,
      productNameSnapshot: 'Pro Monthly',
      settlementFailureCount: 1,
      lastSettlementError: 'Entitlement expired',
      lastSettlementFailedAt: now,
      lastQueryAt: now,
      queryFailureCount: 0,
      lastQueryError: null,
      closedAt: null,
      expiresAt: new Date('2026-09-07T08:10:00.000Z'),
      settledAt: now,
      failedAt: null,
      createdAt: now,
      updatedAt: now,
      refundAttempt,
      user: { id: 'user_1', email: 'user@example.com', displayName: 'User' },
      offer: {
        id: 'offer_1',
        name: 'Monthly',
        billingPeriod: 'MONTHLY',
        product: { id: 'product_1', name: 'Pro', kind: 'PLAN' },
      },
    };
    const findMany = jest.fn().mockResolvedValue([attempt]);
    const service = new OrderQueryService({
      epayPaymentAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany,
        count: jest.fn().mockResolvedValue(1),
      },
    } as never);

    const result = await service.paymentAttempts();

    const [request] = findMany.mock.calls[0] as unknown as [
      {
        where: {
          AND?: Array<{
            OR?: Array<{ fulfillmentStatus?: { in: string[] } }>;
          }>;
        };
      },
    ];
    const fulfillmentFilter = request.where.AND?.flatMap(
      (clause) => clause.OR ?? [],
    ).find((clause) => clause.fulfillmentStatus);
    expect(fulfillmentFilter?.fulfillmentStatus?.in).toEqual([
      'RETRYING',
      'REFUND_PENDING',
      'MANUAL_REVIEW',
    ]);
    expect(result.items[0]).toMatchObject({
      status: 'settled',
      fulfillmentStatus: 'refund_pending',
      fulfillmentPending: true,
      requiresAttention: true,
      refundAttempt: {
        id: 'refund_compensation',
        status: 'pending',
        reasonCode: 'ENTITLEMENT_NO_LONGER_AVAILABLE',
      },
    });
  });

  it('identifies a plan quota reset in order details', async () => {
    const now = new Date('2026-09-06T08:00:00.000Z');
    const order = {
      id: 'order_reset',
      userId: 'user_1',
      user: { id: 'user_1', email: 'user@example.com', displayName: 'User' },
      processedBy: null,
      catalogOfferId: 'offer_1',
      catalogOffer: {
        id: 'offer_1',
        name: 'Monthly',
        billingPeriod: 'MONTHLY',
        product: {
          id: 'product_1',
          name: 'Pro',
          kind: 'PLAN',
          series: 'STANDARD',
        },
      },
      entitlementGrant: null,
      paymentRecords: [],
      refunds: [],
      epayPaymentAttempt: null,
      planId: 'plan_1',
      trafficPackProductId: null,
      planOfferId: null,
      status: 'APPLIED',
      kind: 'RENEWAL',
      source: 'PAYMENT',
      amountCents: 903,
      basePriceCents: 1290,
      discountCents: 387,
      currency: 'CNY',
      productSlugSnapshot: 'pro-monthly',
      productNameSnapshot: 'Pro · 本期流量重置',
      durationDays: null,
      validityDays: null,
      trafficBytes: 100n,
      entitlementExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
      billingPeriodSnapshot: 'MONTHLY',
      intervalMonthsSnapshot: 1,
      accessProfileIdSnapshot: 'profile_1',
      speedUpMbpsSnapshot: 100,
      speedDownMbpsSnapshot: 300,
      deviceLimitSnapshot: 10,
      trafficMultiplierBasisPointsSnapshot: 10_000,
      requiresActivePlanSnapshot: false,
      quotaCadenceSnapshot: 'MONTHLY_RESET',
      resetAnchorAtSnapshot: new Date('2026-09-01T00:00:00.000Z'),
      upgradeFromProductIdSnapshot: null,
      upgradeFromPriceCentsSnapshot: null,
      idempotencyKey: 'epay:reset',
      note: 'PLAN_QUOTA_RESET',
      createdAt: now,
      processedAt: now,
    };
    const service = new OrderQueryService({
      manualOrder: { findUnique: jest.fn().mockResolvedValue(order) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);

    await expect(service.detail('order_reset')).resolves.toMatchObject({
      purchaseMode: 'plan_reset',
    });
  });
});
