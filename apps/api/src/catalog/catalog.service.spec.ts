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

  it('preserves the duration of a migrated legacy offer in the portal catalog', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const prisma = {
      plan: { findMany: jest.fn().mockResolvedValue([]) },
      trafficPackProduct: { findMany: jest.fn().mockResolvedValue([]) },
      accessProfile: { findMany: jest.fn().mockResolvedValue([]) },
      catalogProduct: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'catalog_legacy',
            slug: 'legacy-core',
            kind: 'PLAN',
            status: 'ACTIVE',
            name: 'Core',
            description: null,
            accent: 'green',
            sortOrder: 0,
            accessProfileId: 'profile_1',
            accessProfile: {
              id: 'profile_1',
              name: 'Core access',
              speedUpMbps: 20,
              speedDownMbps: 100,
              deviceLimit: 3,
              nodeBindings: [],
              poolBindings: [
                {
                  priority: 0,
                  pool: {
                    id: 'pool_1',
                    name: 'Default',
                    region: 'HK',
                    active: true,
                    members: [
                      {
                        priority: 0,
                        node: {
                          id: 'node_1',
                          label: 'HK-1',
                          region: 'HK',
                          provider: null,
                          active: true,
                          lifecycleStatus: 'ACTIVE',
                        },
                      },
                    ],
                  },
                },
              ],
            },
            offers: [
              {
                id: 'catalog_offer_legacy',
                slug: 'legacy-core-30d',
                name: '30 天',
                billingPeriod: 'LEGACY',
                intervalMonths: null,
                trafficBytes: 100n,
                priceCents: 1200,
                currency: 'CNY',
                active: true,
                isDefault: true,
                archivedAt: null,
                legacyPlanOffer: { legacyDurationDays: 30 },
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
    };
    const service = new CatalogService(prisma as never);

    const catalog = await service.getPortalCatalog();

    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0].offers[0]).toMatchObject({
      billingPeriod: 'legacy',
      intervalMonths: null,
      legacyDurationDays: 30,
    });
  });
});
