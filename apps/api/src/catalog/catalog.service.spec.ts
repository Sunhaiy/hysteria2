import { CatalogService } from './catalog.service';

describe('CatalogService publishing rules', () => {
  const profile = {
    id: 'profile_1',
    active: true,
    speedUpMbps: 20,
    speedDownMbps: 120,
    deviceLimit: 3,
  };

  function serviceWith(
    tx: Record<string, unknown>,
    cache: Record<string, unknown> = {},
  ) {
    const prisma = {
      ...tx,
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    return new CatalogService(prisma as never, cache as never);
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
        speedUpMbps: 20,
        speedDownMbps: 120,
        defaultTrafficMultiplier: 1,
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
        speedUpMbps: 20,
        speedDownMbps: 120,
        defaultTrafficMultiplier: 1,
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
        speedUpMbps: 20,
        speedDownMbps: 120,
        defaultTrafficMultiplier: 1,
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

  it('updates active speed snapshots and the default multiplier in one transaction', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const periods = ['monthly', 'quarterly', 'yearly'] as const;
    const offers = periods.map((billingPeriod, index) => ({
      id: `offer_${billingPeriod}`,
      slug: `core-${billingPeriod}`,
      name: billingPeriod,
      billingPeriod,
      trafficBytes: 100,
      priceCents: 1000 * (index + 1),
      storeUrl: `https://store.example.com/core/${billingPeriod}`,
      active: true,
      isDefault: index === 0,
    }));
    const existingOffers = offers.map((offer) => ({
      id: offer.id,
      billingPeriod: offer.billingPeriod.toUpperCase(),
      legacyPlanOfferId: null,
    }));
    const tx = {
      accessProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      catalogProduct: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          kind: 'PLAN',
          offers: existingOffers,
          legacyPlanId: null,
          legacyTrafficPackProductId: null,
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'product_1',
            slug: 'core',
            kind: 'PLAN',
            status: 'DRAFT',
            name: 'Core',
            description: null,
            storeUrl: 'https://store.example.com/core',
            speedUpMbps: 35,
            speedDownMbps: 180,
            defaultTrafficMultiplierBasisPoints: 15_000,
            accent: 'green',
            sortOrder: 1,
            accessProfileId: profile.id,
            accessProfile: {
              ...profile,
              name: 'Core access',
              nodeBindings: [],
            },
            offers: offers.map((offer) => ({
              ...offer,
              billingPeriod: offer.billingPeriod.toUpperCase(),
              intervalMonths:
                offer.billingPeriod === 'monthly'
                  ? 1
                  : offer.billingPeriod === 'quarterly'
                    ? 3
                    : 12,
              trafficBytes: BigInt(offer.trafficBytes),
              currency: 'CNY',
              archivedAt: null,
              legacyPlanOffer: null,
            })),
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
      catalogOffer: {
        update: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      entitlementGrant: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      subscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      accessAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const cache = { del: jest.fn().mockResolvedValue(undefined) };
    const service = serviceWith(tx, cache);

    await service.updateProduct('product_1', {
      slug: 'core',
      kind: 'plan',
      status: 'draft',
      name: 'Core',
      storeUrl: 'https://store.example.com/core',
      accessProfileId: profile.id,
      speedUpMbps: 35,
      speedDownMbps: 180,
      defaultTrafficMultiplier: 1.5,
      sortOrder: 1,
      offers,
    });

    const [productUpdate] = tx.catalogProduct.update.mock
      .calls[0] as unknown as [
      { where: { id: string }; data: Record<string, unknown> },
    ];
    expect(productUpdate.where).toEqual({ id: 'product_1' });
    expect(productUpdate.data).toMatchObject({
      storeUrl: 'https://store.example.com/core',
      speedUpMbps: 35,
      speedDownMbps: 180,
      defaultTrafficMultiplierBasisPoints: 15_000,
    });
    const [offerUpdate] = tx.catalogOffer.update.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(offerUpdate.data).toMatchObject({
      storeUrl: 'https://store.example.com/core/monthly',
    });
    const [grantUpdate] = tx.entitlementGrant.updateMany.mock
      .calls[0] as unknown as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(grantUpdate).toMatchObject({
      where: { productId: 'product_1' },
      data: { speedUpMbpsSnapshot: 35, speedDownMbpsSnapshot: 180 },
    });
    const [subscriptionUpdate] = tx.subscription.updateMany.mock
      .calls[0] as unknown as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(subscriptionUpdate).toMatchObject({
      where: { status: 'ACTIVE' },
      data: { speedUpMbpsSnapshot: 35, speedDownMbpsSnapshot: 180 },
    });
    const [accountUpdate] = tx.accessAccount.updateMany.mock
      .calls[0] as unknown as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(accountUpdate).toMatchObject({
      where: {
        trafficMultiplierOverrideBasisPoints: null,
      },
      data: { trafficMultiplierBasisPoints: 15_000 },
    });
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
              nodeBindings: [
                {
                  priority: 0,
                  node: {
                    id: 'node_1',
                    label: 'HK-1',
                    protocol: 'VLESS_REALITY',
                    serverId: 'server_1',
                    server: { name: 'Hong Kong 1' },
                    hostname: 'hk-1.example.com',
                    region: 'HK',
                    provider: null,
                    active: true,
                    lifecycleStatus: 'ACTIVE',
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
    const service = new CatalogService(
      prisma as never,
      {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    const catalog = await service.getPortalCatalog();

    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0].offers[0]).toMatchObject({
      billingPeriod: 'legacy',
      intervalMonths: null,
      legacyDurationDays: 30,
    });
  });

  it('invalidates the published catalog cache after an offer is archived', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const tx = {
      planOffer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'offer_1',
          isDefault: false,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'offer_1',
          slug: 'core-monthly',
          name: 'Monthly',
          billingPeriod: 'MONTHLY',
          intervalMonths: 1,
          legacyDurationDays: null,
          priceCents: 1000,
          active: false,
          isDefault: false,
          archivedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      },
    };
    const cache = { del: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      planOffer: {
        ...tx.planOffer,
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new CatalogService(prisma as never, cache as never);

    await service.archiveOffer('offer_1');

    expect(cache.del).toHaveBeenCalledWith('catalog:portal:v1');
  });
});
