import { BadRequestException } from '@nestjs/common';
import { ControlPlaneStoreService } from './control-plane.store';

describe('Traffic pack product redemption', () => {
  it('creates a traffic pack CDK for the exact yearly catalog offer', async () => {
    const yearlyOffer = {
      id: 'offer_pack_yearly',
      name: '年度包',
      billingPeriod: 'YEARLY',
      intervalMonths: 12,
      trafficBytes: 600n,
      priceCents: 36000,
      product: {
        id: 'catalog_pack',
        kind: 'TRAFFIC_PACK',
        legacyPlanId: null,
        legacyTrafficPackProductId: 'pack_legacy',
      },
    };
    const prisma = {
      catalogOffer: {
        findUnique: jest.fn().mockResolvedValue(yearlyOffer),
      },
      redemptionCode: {
        findUnique: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ControlPlaneStoreService(
      prisma as never,
      { countForUser: jest.fn().mockResolvedValue(0) } as never,
    );

    await service.createRedemptionCode({
      label: '年度流量包',
      code: 'PACK-YEARLY',
      kind: 'traffic_pack',
      catalogOfferId: yearlyOffer.id,
    });

    expect(prisma.redemptionCode.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          code: 'PACK-YEARLY',
          catalogOfferId: yearlyOffer.id,
          trafficPackProductId: 'pack_legacy',
          trafficBytes: 600n,
          amountCents: 36000,
        }),
      ],
    });
  });

  it('rejects a CDK that is not bound to the selected product', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }),
      },
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      trafficPack: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      redemptionCode: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'code_1',
          code: 'PACK-OTHER',
          kind: 'TRAFFIC_PACK',
          status: 'ACTIVE',
          trafficPackProductId: 'pack_other',
          expiresAt: null,
        }),
      },
    };
    const service = new ControlPlaneStoreService(
      prisma as never,
      {
        countForUser: jest.fn().mockResolvedValue(0),
      } as never,
    );

    await expect(
      service.redeemRedemptionCode('user_1', 'PACK-OTHER', 'pack_selected'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolves a legacy plan CDK to the current active offer and quota', async () => {
    const now = new Date('2026-08-31T04:19:48.000Z');
    const plan = {
      id: 'plan_pro',
      durationDays: 30,
    };
    const currentOffer = {
      id: 'offer_pro_monthly_current',
      slug: 'pro-monthly',
      name: '月付',
      billingPeriod: 'MONTHLY',
      intervalMonths: 1,
      priceCents: 1290,
      currency: 'CNY',
      trafficBytes: 120n,
      legacyPlanOfferId: 'legacy_offer_pro_monthly',
      product: {
        id: 'catalog_pro',
        name: 'Pro',
        kind: 'PLAN',
        accessProfileId: 'profile_pro',
        purchaseLimitPerUser: null,
        purchaseLimitKey: null,
        requiresActivePlan: false,
        legacyPlan: plan,
      },
    };
    const tx = {
      catalogOffer: {
        findFirst: jest.fn().mockResolvedValue(currentOffer),
      },
      manualOrder: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'order_pro_current', ...data }),
          ),
      },
    };
    const service = new ControlPlaneStoreService(
      {} as never,
      { countForUser: jest.fn().mockResolvedValue(0) } as never,
    );
    const internals = service as unknown as {
      grantPlanEntitlement: jest.Mock;
      applyPlanRedemptionCode: (
        client: typeof tx,
        input: Record<string, unknown>,
      ) => Promise<{ trafficBytes: bigint; catalogOfferId: string }>;
    };
    internals.grantPlanEntitlement = jest.fn().mockResolvedValue(undefined);

    const order = await internals.applyPlanRedemptionCode(tx, {
      userId: 'user_1',
      code: {
        code: 'OLD-PRO-CDK',
        note: null,
        planId: plan.id,
        plan,
        catalogOfferId: null,
        catalogOffer: null,
        planMode: 'RENEW',
      },
      openSubscription: {
        id: 'subscription_go',
        planId: 'plan_go',
        endsAt: new Date('2026-09-30T04:00:00.000Z'),
      },
      redeemedAt: now,
    });

    expect(tx.catalogOffer.findFirst).toHaveBeenCalledWith({
      where: {
        product: { legacyPlanId: plan.id },
        active: true,
        archivedAt: null,
      },
      include: { product: { include: { legacyPlan: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    expect(order).toMatchObject({
      catalogOfferId: currentOffer.id,
      trafficBytes: 120n,
    });
    expect(internals.grantPlanEntitlement).toHaveBeenCalledWith(tx, {
      userId: 'user_1',
      planId: plan.id,
      grantedAt: now,
      openSubscription: {
        id: 'subscription_go',
        planId: 'plan_go',
        endsAt: new Date('2026-09-30T04:00:00.000Z'),
      },
      durationMonths: 1,
      planOfferId: 'legacy_offer_pro_monthly',
      trafficBytes: 120n,
      forceReplace: false,
    });
  });

  it('redeems a plan CDK through its access profile when legacy bindings are retired', async () => {
    const now = new Date('2026-08-24T08:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const user = {
      id: 'user_1',
      email: 'member@example.com',
      displayName: 'Member',
      balanceCents: 0,
    };
    const plan = {
      id: 'plan_pro',
      name: 'Pro 500',
      accessProfileId: 'profile_pro',
      durationDays: 30,
      trafficBytes: 500n,
      speedUpMbps: 40,
      speedDownMbps: 240,
      deviceLimit: 5,
    };
    const offer = {
      id: 'offer_quarterly',
      slug: 'pro-quarterly',
      name: 'Quarterly',
      billingPeriod: 'QUARTERLY',
      intervalMonths: 3,
      priceCents: 8900,
      currency: 'CNY',
      trafficBytes: 500n,
      legacyPlanOfferId: 'legacy_offer_quarterly',
      product: {
        id: 'catalog_pro',
        name: 'Pro 500',
        accessProfileId: 'profile_pro',
        legacyPlan: plan,
      },
    };
    const code = {
      id: 'code_plan',
      code: 'PLAN-QUARTERLY',
      label: 'Quarterly plan CDK',
      kind: 'PLAN',
      status: 'ACTIVE',
      planId: plan.id,
      plan,
      catalogOfferId: offer.id,
      catalogOffer: offer,
      trafficPackProductId: null,
      trafficPackProduct: null,
      trafficBytes: null,
      amountCents: 100,
      discountPercent: null,
      discountCents: null,
      planMode: 'RENEW',
      maxUses: 1,
      usedCount: 0,
      note: null,
      expiresAt: null,
      createdById: 'admin_1',
      createdBy: null,
      redeemedById: null,
      redeemedBy: null,
      redeemedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      subscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'subscription_1' }),
      },
      trafficPack: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      redemptionCode: {
        findUnique: jest.fn().mockResolvedValue(code),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 1 }),
        update: jest.fn().mockResolvedValue({
          ...code,
          status: 'REDEEMED',
          usedCount: 1,
          redeemedById: user.id,
          redeemedBy: user,
          redeemedAt: now,
        }),
      },
      redemptionUse: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      manualOrder: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'order_plan_cdk',
            ...data,
            user,
            processedById: null,
            processedBy: null,
            plan,
            trafficPackProduct: null,
            createdAt: now,
          }),
        ),
      },
      plan: { findUnique: jest.fn().mockResolvedValue(plan) },
      accessProfileNode: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ nodeId: 'node_reality', priority: 0 }]),
      },
      planBinding: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ nodeId: 'node_retired', priority: 0 }]),
      },
      node: {
        findUnique: jest
          .fn()
          .mockImplementation((input: { where: { id: string } }) =>
            Promise.resolve(
              input.where.id === 'node_reality' ? { id: 'node_reality' } : null,
            ),
          ),
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ControlPlaneStoreService(
      prisma as never,
      {
        countForUser: jest.fn().mockResolvedValue(0),
      } as never,
    );

    const result = await service.redeemRedemptionCode(user.id, code.code);

    const [orderCreate] = tx.manualOrder.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(orderCreate.data).toMatchObject({
      source: 'CDK',
      amountCents: 8900,
      basePriceCents: 8900,
      discountCents: 0,
      catalogOfferId: offer.id,
    });
    expect(result?.order).toMatchObject({
      amountCents: 8900,
      basePriceCents: 8900,
    });
    expect(tx.accessProfileNode.findMany).toHaveBeenCalledWith({
      where: {
        accessProfileId: 'profile_pro',
        node: {
          active: true,
          lifecycleStatus: 'ACTIVE',
          retiredAt: null,
        },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    expect(tx.planBinding.findMany).not.toHaveBeenCalled();
    const [subscriptionCreate] = tx.subscription.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(subscriptionCreate.data.nodeId).toBe('node_reality');
    jest.useRealTimers();
  });

  it('redeems a permanent traffic pack offer without an active plan', async () => {
    const now = new Date('2026-08-26T08:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const user = {
      id: 'user_1',
      email: 'member@example.com',
      displayName: 'Member',
      balanceCents: 0,
    };
    const offer = {
      id: 'offer_pack_one_time',
      slug: 'pack-100g-one-time',
      name: '一次性',
      billingPeriod: 'ONE_TIME',
      intervalMonths: null,
      priceCents: 7200,
      currency: 'CNY',
      trafficBytes: 100n,
      product: {
        id: 'catalog_pack',
        name: '100 GB 流量包',
        kind: 'TRAFFIC_PACK',
        accessProfileId: 'profile_pack',
        legacyPlan: null,
        legacyTrafficPackProductId: 'pack_legacy',
        requiresActivePlan: false,
      },
    };
    const code = {
      id: 'code_pack',
      code: 'PACK-PERMANENT',
      label: '永久流量包',
      kind: 'TRAFFIC_PACK',
      status: 'ACTIVE',
      planId: null,
      plan: null,
      catalogOfferId: offer.id,
      catalogOffer: offer,
      trafficPackProductId: 'pack_legacy',
      trafficPackProduct: null,
      trafficBytes: 100n,
      amountCents: 7200,
      discountPercent: null,
      discountCents: null,
      planMode: 'RENEW',
      maxUses: 1,
      usedCount: 0,
      note: null,
      expiresAt: null,
      createdById: 'admin_1',
      createdBy: null,
      redeemedById: null,
      redeemedBy: null,
      redeemedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      trafficPack: {
        create: jest.fn().mockResolvedValue({ id: 'traffic_pack_1' }),
      },
      redemptionCode: {
        findUnique: jest.fn().mockResolvedValue(code),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({
          ...code,
          status: 'REDEEMED',
          usedCount: 1,
          redeemedById: user.id,
          redeemedBy: user,
          redeemedAt: now,
        }),
      },
      redemptionUse: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      manualOrder: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'order_pack_cdk',
            ...data,
            user,
            processedById: null,
            processedBy: null,
            planId: null,
            plan: null,
            trafficPackProduct: null,
            createdAt: now,
          }),
        ),
      },
    };
    const prisma = {
      ...tx,
      subscription: {
        ...tx.subscription,
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      trafficPack: {
        ...tx.trafficPack,
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      redemptionCode: {
        ...tx.redemptionCode,
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback({
          ...tx,
          redemptionCode: {
            ...tx.redemptionCode,
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        }),
      ),
    };
    const service = new ControlPlaneStoreService(
      prisma as never,
      { countForUser: jest.fn().mockResolvedValue(0) } as never,
    );

    await service.redeemRedemptionCode(user.id, code.code);

    const [orderCreate] = tx.manualOrder.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(orderCreate.data).toMatchObject({
      catalogOfferId: offer.id,
      amountCents: 7200,
      basePriceCents: 7200,
      validityDays: null,
      billingPeriodSnapshot: 'ONE_TIME',
      intervalMonthsSnapshot: null,
      entitlementExpiresAt: new Date('9999-12-31T23:59:59.999Z'),
    });
    const [packCreate] = tx.trafficPack.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(packCreate.data).toMatchObject({
      trafficPackProductId: 'pack_legacy',
      totalBytes: 100n,
      remainingBytes: 100n,
      subscriptionId: null,
      expiresAt: null,
    });
    jest.useRealTimers();
  });
});
