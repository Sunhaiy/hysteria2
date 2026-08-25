import { BadRequestException } from '@nestjs/common';
import { ControlPlaneStoreService } from './control-plane.store';

describe('Traffic pack product redemption', () => {
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

  it('recognizes a plan CDK at the bound offer price instead of its face value', async () => {
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
      planBinding: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ nodeId: 'node_reality', priority: 0 }]),
      },
      node: { findUnique: jest.fn().mockResolvedValue({ id: 'node_reality' }) },
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
    jest.useRealTimers();
  });
});
