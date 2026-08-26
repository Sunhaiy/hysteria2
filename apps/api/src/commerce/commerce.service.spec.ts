import { CommerceService } from './commerce.service';

describe('CommerceService checkout', () => {
  afterEach(() => jest.useRealTimers());

  it('materializes a V2 entitlement for a traffic pack CDK redemption', async () => {
    const store = {
      redeemRedemptionCode: jest.fn().mockResolvedValue({
        code: { id: 'code_pack' },
        order: { id: 'order_pack_cdk' },
        balanceCents: 0,
      }),
    };
    const prisma = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          catalogOfferId: 'offer_pack',
          kind: 'TRAFFIC_PACK',
          trafficPackProductId: 'pack_legacy',
          trafficBytes: 100n,
          entitlementExpiresAt: new Date('2027-08-26T08:00:00.000Z'),
          accessProfileIdSnapshot: 'profile_pack',
        }),
      },
      trafficPack: {
        findFirst: jest.fn().mockResolvedValue({ id: 'traffic_pack_1' }),
      },
    };
    const entitlements = { grantFromOrder: jest.fn().mockResolvedValue({}) };
    const service = new CommerceService(
      prisma as never,
      store as never,
      entitlements as never,
    );

    await service.redeem('user_1', 'PACK-YEARLY');

    expect(prisma.trafficPack.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        trafficPackProductId: 'pack_legacy',
        totalBytes: 100n,
        expiresAt: new Date('2027-08-26T08:00:00.000Z'),
        accessProfileId: 'profile_pack',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(entitlements.grantFromOrder).toHaveBeenCalledWith({
      orderId: 'order_pack_cdk',
      trafficPackId: 'traffic_pack_1',
    });
  });

  it('returns the original order for a repeated idempotency key', async () => {
    const existingOrder = {
      id: 'order_1',
      userId: 'user_1',
      idempotencyKey: 'checkout-1',
      status: 'APPLIED',
      planId: null,
      trafficPackProductId: 'pack_100g',
    };
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue(existingOrder),
        create: jest.fn(),
      },
      user: { updateMany: jest.fn() },
      trafficPack: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CommerceService(prisma as never, {} as never);

    const result = await service.checkout(
      'user_1',
      { kind: 'traffic_pack', productId: 'pack_100g' },
      'checkout-1',
    );

    expect(result).toMatchObject({ orderId: 'order_1', replayed: true });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.manualOrder.create).not.toHaveBeenCalled();
    expect(tx.trafficPack.create).not.toHaveBeenCalled();
  });

  it('checks out a traffic pack with an immutable order snapshot', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    const subscriptionEndsAt = new Date('2026-08-20T00:00:00.000Z');
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'order_2', ...data }),
          ),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      trafficPackProduct: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pack_100g',
          slug: 'traffic-100g',
          name: '100 GB booster',
          active: true,
          archivedAt: null,
          trafficBytes: 107374182400n,
          validityDays: 30,
          priceCents: 1000,
          accessProfileId: 'profile_core',
          accessProfile: {
            active: true,
            nodeBindings: [{ nodeId: 'node_1' }],
          },
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'subscription_1',
          endsAt: subscriptionEndsAt,
        }),
      },
      redemptionCode: { findUnique: jest.fn() },
      walletTransaction: { create: jest.fn().mockResolvedValue({}) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      trafficPack: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CommerceService(prisma as never, {} as never);

    const result = await service.checkout(
      'user_1',
      { kind: 'traffic_pack', productId: 'pack_100g' },
      'checkout-2',
    );

    expect(result).toMatchObject({
      orderId: 'order_2',
      replayed: false,
      kind: 'traffic_pack',
      productName: '100 GB booster',
      chargedCents: 1000,
      entitlementExpiresAt: subscriptionEndsAt.toISOString(),
    });
    jest.useRealTimers();
  });

  it('rejects checkout when a discount code loses its last concurrent slot', async () => {
    const tx = {
      manualOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
        }),
        updateMany: jest.fn(),
      },
      trafficPackProduct: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pack_100g',
          slug: 'traffic-100g',
          name: '100 GB booster',
          active: true,
          archivedAt: null,
          trafficBytes: 107374182400n,
          validityDays: 30,
          priceCents: 1000,
          accessProfileId: 'profile_core',
          accessProfile: {
            active: true,
            nodeBindings: [{ nodeId: 'node_1' }],
          },
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'subscription_1',
          endsAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      },
      redemptionCode: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'discount_1',
          code: 'LAST20',
          label: '20 percent off',
          kind: 'DISCOUNT',
          status: 'ACTIVE',
          usedCount: 0,
          maxUses: 1,
          discountPercent: 20,
          discountCents: null,
          expiresAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      redemptionUse: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CommerceService(prisma as never, {} as never);

    await expect(
      service.checkout(
        'user_1',
        {
          kind: 'traffic_pack',
          productId: 'pack_100g',
          discountCode: 'LAST20',
        },
        'checkout-last-slot',
      ),
    ).rejects.toThrow('Discount code is no longer available');
  });

  it('checks out a membership plan through the same interface', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'order_plan', ...data }),
          ),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      plan: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'plan_core',
          slug: 'core-200',
          name: 'Core 200',
          active: true,
          priceCents: 1800,
          durationDays: 30,
          trafficBytes: 214748364800n,
          speedUpMbps: 20,
          speedDownMbps: 120,
          deviceLimit: 3,
          accessProfileId: null,
        }),
      },
      planOffer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'offer_core',
          planId: 'plan_core',
          slug: 'core-200-legacy',
          name: '30 天',
          active: true,
          isDefault: true,
          billingPeriod: 'LEGACY',
          intervalMonths: null,
          legacyDurationDays: 30,
          priceCents: 1800,
          archivedAt: null,
        }),
      },
      planBinding: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ nodeId: 'node_1', priority: 0 }]),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      redemptionCode: { findUnique: jest.fn() },
      walletTransaction: { create: jest.fn().mockResolvedValue({}) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CommerceService(prisma as never, {} as never);

    const result = await service.checkout(
      'user_1',
      { kind: 'plan', productId: 'plan_core' },
      'checkout-plan',
    );

    expect(result).toMatchObject({
      orderId: 'order_plan',
      replayed: false,
      kind: 'plan',
      productName: 'Core 200 · 30 天',
      chargedCents: 1800,
      entitlementExpiresAt: '2026-09-13T00:00:00.000Z',
    });
    jest.useRealTimers();
  });

  it('replays a checkout submitted with the same V2 offer id', async () => {
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_offer',
          planId: null,
          planOfferId: null,
          trafficPackProductId: 'traffic_50g',
          catalogOfferId: 'catalog_offer_pack_quarterly',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CommerceService(prisma as never, {} as never);

    await expect(
      service.checkout(
        'user_1',
        { offerId: 'catalog_offer_pack_quarterly' },
        'offer-checkout-1',
      ),
    ).resolves.toEqual({
      orderId: 'order_offer',
      replayed: true,
      kind: undefined,
    });
  });

  it('grants a standalone traffic pack without requiring a subscription', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-31T08:00:00.000Z'));
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'order_pack_v2', ...data }),
          ),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
          balanceCents: 5000,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      catalogOffer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'catalog_offer_pack_quarterly',
          slug: 'pack-flex-quarterly',
          name: '季度流量包',
          billingPeriod: 'QUARTERLY',
          intervalMonths: 3,
          trafficBytes: 50n,
          priceCents: 900,
          currency: 'CNY',
          active: true,
          archivedAt: null,
          legacyPlanOfferId: null,
          product: {
            id: 'catalog_pack',
            name: '灵活流量包',
            kind: 'TRAFFIC_PACK',
            status: 'ACTIVE',
            accessProfileId: 'profile_core',
            legacyPlanId: null,
            legacyTrafficPackProductId: 'traffic_50g',
            legacyPlan: null,
            accessProfile: {
              active: true,
              speedUpMbps: 20,
              speedDownMbps: 120,
              deviceLimit: 3,
            },
          },
        }),
      },
      accessProfileNode: {
        findFirst: jest.fn().mockResolvedValue({ nodeId: 'node_hk_core' }),
      },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      trafficPack: {
        create: jest.fn().mockResolvedValue({ id: 'pack_v2' }),
      },
      subscription: { findFirst: jest.fn() },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'wallet_1' }),
      },
      walletLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
      paymentRecord: { create: jest.fn().mockResolvedValue({}) },
      redemptionUse: { create: jest.fn() },
    };
    const entitlements = { grantFromOrder: jest.fn().mockResolvedValue({}) };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CommerceService(
      prisma as never,
      {} as never,
      entitlements as never,
    );

    const result = await service.checkout(
      'user_1',
      { offerId: 'catalog_offer_pack_quarterly' },
      'offer-pack-v2',
    );

    expect(result).toMatchObject({
      orderId: 'order_pack_v2',
      replayed: false,
      kind: 'traffic_pack',
      chargedCents: 900,
      entitlementExpiresAt: '2027-04-30T08:00:00.000Z',
    });
    expect(tx.subscription.findFirst).not.toHaveBeenCalled();
    const [packCreate] = tx.trafficPack.create.mock.calls[0] as unknown as [
      {
        data: {
          subscriptionId: string | null;
          totalBytes: bigint;
          remainingBytes: bigint;
        };
      },
    ];
    expect(packCreate.data).toMatchObject({
      subscriptionId: null,
      totalBytes: 50n,
      remainingBytes: 50n,
    });
    expect(entitlements.grantFromOrder).toHaveBeenCalledWith(
      {
        orderId: 'order_pack_v2',
        subscriptionId: undefined,
        trafficPackId: 'pack_v2',
      },
      tx,
    );
  });

  it('grants a complimentary plan, switches immediately, and clamps the first monthly cycle', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-31T08:00:00.000Z'));
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'order_plan_v2', ...data }),
          ),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
          balanceCents: 15000,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      catalogOffer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'catalog_offer_pro_quarterly',
          slug: 'pro-quarterly',
          name: '季付',
          billingPeriod: 'QUARTERLY',
          intervalMonths: 3,
          trafficBytes: 500n,
          priceCents: 8900,
          currency: 'CNY',
          active: true,
          archivedAt: null,
          legacyPlanOfferId: 'offer_pro_quarterly',
          product: {
            id: 'catalog_pro',
            name: 'Pro 500',
            kind: 'PLAN',
            status: 'ACTIVE',
            accessProfileId: 'profile_pro',
            legacyPlanId: 'plan_pro',
            legacyTrafficPackProductId: null,
            legacyPlan: { id: 'plan_pro' },
            accessProfile: {
              active: true,
              speedUpMbps: 40,
              speedDownMbps: 240,
              deviceLimit: 5,
            },
          },
        }),
      },
      accessProfileNode: {
        findFirst: jest.fn().mockResolvedValue({ nodeId: 'node_hk_pro' }),
      },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sub_old',
          planId: 'plan_core',
          endsAt: new Date('2027-02-15T08:00:00.000Z'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'sub_new' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          endsAt: new Date('2027-04-30T08:00:00.000Z'),
        }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'wallet_2' }),
      },
      walletLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
      paymentRecord: { create: jest.fn().mockResolvedValue({}) },
      redemptionUse: { create: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const entitlements = { grantFromOrder: jest.fn().mockResolvedValue({}) };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CommerceService(
      prisma as never,
      {} as never,
      entitlements as never,
    );

    const result = await service.grantComplimentaryPlan(
      'user_1',
      'catalog_offer_pro_quarterly',
      'admin_1',
      'complimentary-plan-v2',
    );

    expect(result.chargedCents).toBe(0);
    expect(result.entitlementExpiresAt).toBe('2027-04-30T08:00:00.000Z');
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.paymentRecord.create).not.toHaveBeenCalled();
    const [orderCreate] = tx.manualOrder.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(orderCreate.data).toMatchObject({
      source: 'ADMIN',
      amountCents: 0,
      basePriceCents: 8900,
      discountCents: 8900,
      idempotencyKey: 'complimentary-plan-v2',
    });
    const [auditCreate] = tx.auditLog.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(auditCreate.data).toMatchObject({
      actorId: 'admin_1',
      action: 'COMPLIMENTARY_PLAN_GRANTED',
      targetId: 'order_plan_v2',
    });
    expect(tx.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'CANCELED',
          endsAt: new Date('2027-01-31T08:00:00.000Z'),
        },
      }),
    );
    const [subscriptionCreate] = tx.subscription.create.mock
      .calls[0] as unknown as [
      {
        data: {
          planId: string;
          startsAt: Date;
          endsAt: Date;
          cycles: {
            create: { startsAt: Date; endsAt: Date; grantedBytes: bigint };
          };
        };
      },
    ];
    expect(subscriptionCreate.data).toMatchObject({
      planId: 'plan_pro',
      startsAt: new Date('2027-01-31T08:00:00.000Z'),
      endsAt: new Date('2027-04-30T08:00:00.000Z'),
      cycles: {
        create: {
          startsAt: new Date('2027-01-31T08:00:00.000Z'),
          endsAt: new Date('2027-02-28T08:00:00.000Z'),
          grantedBytes: 500n,
        },
      },
    });
  });

  it('checks out a migrated legacy catalog offer using its day duration', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-31T08:00:00.000Z'));
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'order_plan_legacy', ...data }),
          ),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
          balanceCents: 5000,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      catalogOffer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'catalog_offer_legacy',
          slug: 'core-30d',
          name: '30 天',
          billingPeriod: 'LEGACY',
          intervalMonths: null,
          trafficBytes: 100n,
          priceCents: 1200,
          currency: 'CNY',
          active: true,
          archivedAt: null,
          legacyPlanOfferId: 'offer_legacy',
          legacyPlanOffer: { legacyDurationDays: 30 },
          product: {
            id: 'catalog_core',
            name: 'Core',
            kind: 'PLAN',
            status: 'ACTIVE',
            accessProfileId: 'profile_core',
            legacyPlanId: 'plan_core',
            legacyTrafficPackProductId: null,
            legacyPlan: { id: 'plan_core' },
            accessProfile: {
              active: true,
              speedUpMbps: 20,
              speedDownMbps: 100,
              deviceLimit: 3,
            },
          },
        }),
      },
      accessProfileNode: {
        findFirst: jest.fn().mockResolvedValue({ nodeId: 'node_1' }),
      },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'sub_legacy' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          endsAt: new Date('2027-03-02T08:00:00.000Z'),
        }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'wallet_legacy' }),
      },
      walletLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
      paymentRecord: { create: jest.fn().mockResolvedValue({}) },
      redemptionUse: { create: jest.fn() },
    };
    const entitlements = { grantFromOrder: jest.fn().mockResolvedValue({}) };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CommerceService(
      prisma as never,
      {} as never,
      entitlements as never,
    );

    const result = await service.checkout(
      'user_1',
      { offerId: 'catalog_offer_legacy' },
      'offer-plan-legacy',
    );

    expect(result.entitlementExpiresAt).toBe('2027-03-02T08:00:00.000Z');
    const [subscriptionCreate] = tx.subscription.create.mock
      .calls[0] as unknown as [
      {
        data: {
          endsAt: Date;
          cycles: { create: { endsAt: Date } };
        };
      },
    ];
    expect(subscriptionCreate.data).toMatchObject({
      endsAt: new Date('2027-03-02T08:00:00.000Z'),
      cycles: {
        create: {
          endsAt: new Date('2027-02-28T08:00:00.000Z'),
        },
      },
    });
    jest.useRealTimers();
  });
});
