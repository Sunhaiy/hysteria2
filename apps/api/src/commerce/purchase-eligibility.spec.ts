import { BadRequestException } from '@nestjs/common';
import { CatalogProductKind } from '@prisma/client';
import { assertCatalogPurchaseEligibility } from './purchase-eligibility';

describe('catalog purchase eligibility', () => {
  it('rejects a second lifetime purchase without changing an order or CDK', async () => {
    const client = {
      manualOrder: { count: jest.fn().mockResolvedValue(1) },
      entitlementGrant: { count: jest.fn() },
      subscription: { count: jest.fn() },
    };

    await expect(
      assertCatalogPurchaseEligibility(client as never, 'user_1', {
        kind: CatalogProductKind.PLAN,
        purchaseLimitPerUser: 1,
        purchaseLimitKey: 'trial-go',
        requiresActivePlan: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.entitlementGrant.count).not.toHaveBeenCalled();
    expect(client.subscription.count).not.toHaveBeenCalled();
  });

  it('requires an active plan for an add-on traffic pack', async () => {
    const client = {
      manualOrder: { count: jest.fn() },
      entitlementGrant: { count: jest.fn().mockResolvedValue(0) },
      subscription: { count: jest.fn().mockResolvedValue(0) },
    };

    await expect(
      assertCatalogPurchaseEligibility(client as never, 'user_1', {
        kind: CatalogProductKind.TRAFFIC_PACK,
        purchaseLimitPerUser: null,
        purchaseLimitKey: null,
        requiresActivePlan: true,
      }),
    ).rejects.toThrow('需要先开通有效套餐');
  });

  it('accepts an add-on traffic pack while a plan is active', async () => {
    const client = {
      manualOrder: { count: jest.fn() },
      entitlementGrant: { count: jest.fn().mockResolvedValue(1) },
      subscription: { count: jest.fn().mockResolvedValue(1) },
    };

    await expect(
      assertCatalogPurchaseEligibility(client as never, 'user_1', {
        kind: CatalogProductKind.TRAFFIC_PACK,
        purchaseLimitPerUser: null,
        purchaseLimitKey: null,
        requiresActivePlan: true,
      }),
    ).resolves.toBeUndefined();
  });
});
