import { CatalogService } from './catalog.service';

describe('CatalogService publishing rules', () => {
  const profile = {
    id: 'profile_1',
    active: true,
    speedUpMbps: 20,
    speedDownMbps: 120,
    deviceLimit: 3,
  };

  function serviceWith(tx: Record<string, unknown>) {
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    return new CatalogService(prisma as never);
  }

  it('rejects a catalog product without any offers', async () => {
    const tx = { accessProfile: { findUnique: jest.fn() } };
    const service = serviceWith(tx);

    await expect(
      service.createProduct({
        slug: 'empty',
        kind: 'plan',
        status: 'draft',
        name: 'Empty draft',
        accessProfileId: 'profile_1',
        offers: [],
      }),
    ).rejects.toThrow('At least one catalog offer is required');
    expect(tx.accessProfile.findUnique).not.toHaveBeenCalled();
  });

  it('requires monthly, quarterly, and yearly offers before publishing a plan', async () => {
    const tx = {
      accessProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
    };
    const service = serviceWith(tx);

    await expect(
      service.createProduct({
        slug: 'incomplete-plan',
        kind: 'plan',
        status: 'active',
        name: 'Incomplete plan',
        accessProfileId: 'profile_1',
        offers: [
          {
            slug: 'incomplete-plan-quarterly',
            name: 'Quarterly',
            billingPeriod: 'quarterly',
            trafficBytes: 100,
            priceCents: 1000,
            active: true,
          },
          {
            slug: 'incomplete-plan-yearly',
            name: 'Yearly',
            billingPeriod: 'yearly',
            trafficBytes: 100,
            priceCents: 3000,
            active: true,
          },
        ],
      }),
    ).rejects.toThrow(
      'Published plans require monthly, quarterly and yearly offers',
    );
  });

  it('allows only quarterly and yearly offers for a published traffic pack', async () => {
    const tx = {
      accessProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
    };
    const service = serviceWith(tx);

    await expect(
      service.createProduct({
        slug: 'invalid-pack',
        kind: 'traffic_pack',
        status: 'active',
        name: 'Invalid pack',
        accessProfileId: 'profile_1',
        offers: [
          {
            slug: 'invalid-pack-monthly',
            name: 'Monthly',
            billingPeriod: 'monthly',
            trafficBytes: 100,
            priceCents: 500,
            active: true,
          },
          {
            slug: 'invalid-pack-quarterly',
            name: 'Quarterly',
            billingPeriod: 'quarterly',
            trafficBytes: 100,
            priceCents: 1000,
            active: true,
          },
          {
            slug: 'invalid-pack-yearly',
            name: 'Yearly',
            billingPeriod: 'yearly',
            trafficBytes: 400,
            priceCents: 3000,
            active: true,
          },
        ],
      }),
    ).rejects.toThrow(
      'Published traffic packs require quarterly and yearly offers',
    );
  });
});
