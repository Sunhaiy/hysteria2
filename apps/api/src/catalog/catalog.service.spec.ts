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

  it('requires a monthly offer before publishing a plan', async () => {
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
    ).rejects.toThrow('Published plans require a monthly offer');
  });

  it('requires exactly one permanent offer for a traffic pack', async () => {
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
        ],
      }),
    ).rejects.toThrow(
      'Traffic packs require exactly one permanent one-time offer',
    );
  });

  it('creates a product-owned node binding instead of mutating a shared profile', async () => {
    const tx = {
      node: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'node_1', active: true, lifecycleStatus: 'ACTIVE' },
          ]),
      },
      accessProfile: {
        findUnique: jest.fn().mockResolvedValue({
          ...profile,
          slug: 'shared-profile',
        }),
        create: jest.fn().mockResolvedValue({
          ...profile,
          id: 'profile_owned',
          slug: 'catalog-product-product_1',
        }),
      },
    };
    const service = serviceWith(tx);
    const productInput = {
      slug: 'core',
      kind: 'plan' as const,
      status: 'draft' as const,
      name: 'Core',
      nodeIds: ['node_1'],
      deviceLimit: 4,
      speedUpMbps: 30,
      speedDownMbps: 150,
      defaultTrafficMultiplier: 1.5,
      offers: [
        {
          slug: 'core-monthly',
          name: 'Monthly',
          billingPeriod: 'monthly' as const,
          trafficBytes: 100,
          priceCents: 1000,
          active: true,
        },
      ],
    };
    const resolver = service as unknown as {
      resolveProductAccessProfile(
        client: typeof tx,
        input: typeof productInput,
        productId: string,
        series: 'STANDARD' | 'ULTRA',
        currentProfileId?: string,
      ): Promise<{ id: string }>;
    };

    const result = await resolver.resolveProductAccessProfile(
      tx,
      productInput,
      'product_1',
      'STANDARD',
      'profile_shared',
    );

    expect(result.id).toBe('profile_owned');
    const [createProfile] = tx.accessProfile.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(createProfile.data).toMatchObject({
      slug: 'catalog-product-product_1',
      deviceLimit: 4,
      nodeBindings: { create: [{ nodeId: 'node_1', priority: 0 }] },
    });
  });

  it('moves selected nodes into the shared Ultra profile and audits the change', async () => {
    const tx = {
      node: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'node_ultra', active: true, lifecycleStatus: 'ACTIVE' },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      accessProfileNode: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      accessProfile: {
        upsert: jest.fn().mockResolvedValue({
          id: 'catalog-ultra-shared',
          deviceLimit: 1000,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = serviceWith(tx);
    const input = {
      slug: 'ultra-120',
      kind: 'traffic_pack' as const,
      series: 'ultra' as const,
      status: 'draft' as const,
      name: '普通线路 Ultra 120',
      nodeIds: ['node_ultra'],
      speedUpMbps: 1,
      speedDownMbps: 1,
      defaultTrafficMultiplier: 2.1,
      offers: [
        {
          slug: 'ultra-120-once',
          name: '永久版',
          billingPeriod: 'one_time' as const,
          trafficBytes: 120,
          priceCents: 6_900,
          active: true,
        },
      ],
    };
    const resolver = service as unknown as {
      resolveProductAccessProfile(
        client: typeof tx,
        productInput: typeof input,
        productId: string,
        series: 'ULTRA',
        currentProfileId: string | undefined,
        actorId: string,
      ): Promise<{ id: string }>;
    };

    await resolver.resolveProductAccessProfile(
      tx,
      input,
      'product_ultra_120',
      'ULTRA',
      undefined,
      'admin_1',
    );

    expect(tx.accessProfileNode.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        nodeId: { in: ['node_ultra'] },
        accessProfileId: { not: 'catalog-ultra-shared' },
      },
    });
    expect(tx.node.updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['node_ultra'] } },
      data: { exclusiveAccessProfileId: 'catalog-ultra-shared' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin_1',
        action: 'catalog.ultra_nodes.updated',
        targetType: 'access_profile',
        targetId: 'catalog-ultra-shared',
        metadata: {
          productId: 'product_ultra_120',
          nodeIds: ['node_ultra'],
        },
      },
    });
  });

  it('rejects publishing Ultra when the shared profile has no serviceable node', async () => {
    const tx = {
      node: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = serviceWith(tx);
    const input = {
      slug: 'ultra-120',
      kind: 'traffic_pack' as const,
      series: 'ultra' as const,
      status: 'active' as const,
      name: '普通线路 Ultra 120',
      speedUpMbps: 300,
      speedDownMbps: 300,
      defaultTrafficMultiplier: 1,
      offers: [
        {
          slug: 'ultra-120-once',
          name: '永久版',
          billingPeriod: 'one_time' as const,
          trafficBytes: 120,
          priceCents: 6_900,
          active: true,
        },
      ],
    };
    const resolver = service as unknown as {
      resolveProductAccessProfile(
        client: typeof tx,
        productInput: typeof input,
        productId: string,
        series: 'ULTRA',
      ): Promise<{ id: string }>;
    };

    await expect(
      resolver.resolveProductAccessProfile(
        tx,
        input,
        'product_ultra_120',
        'ULTRA',
      ),
    ).rejects.toThrow('Published Ultra products require a serviceable node');
  });

  it('rejects Ultra-exclusive nodes in a standard product profile', async () => {
    const tx = {
      node: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'node_ultra',
            active: true,
            lifecycleStatus: 'ACTIVE',
            exclusiveAccessProfileId: 'catalog-ultra-shared',
          },
        ]),
      },
    };
    const service = serviceWith(tx);
    const input = {
      slug: 'standard',
      kind: 'plan' as const,
      status: 'draft' as const,
      name: 'Standard',
      nodeIds: ['node_ultra'],
      speedUpMbps: 100,
      speedDownMbps: 100,
      defaultTrafficMultiplier: 1,
      offers: [
        {
          slug: 'standard-monthly',
          name: '月付',
          billingPeriod: 'monthly' as const,
          trafficBytes: 100,
          priceCents: 1_000,
          active: true,
        },
      ],
    };
    const resolver = service as unknown as {
      resolveProductAccessProfile(
        client: typeof tx,
        productInput: typeof input,
        productId: string,
        series: 'STANDARD',
      ): Promise<{ id: string }>;
    };

    await expect(
      resolver.resolveProductAccessProfile(
        tx,
        input,
        'product_standard',
        'STANDARD',
      ),
    ).rejects.toThrow('Ultra exclusive nodes cannot be assigned');
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
      trafficBytes: BigInt(offers[0].trafficBytes),
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
      data: { trafficMultiplierBasisPoints: 15_000 },
    });
  });

  it('preserves the duration of a migrated legacy offer in the portal catalog', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const prisma = {
      plan: { findMany: jest.fn().mockResolvedValue([]) },
      trafficPackProduct: { findMany: jest.fn().mockResolvedValue([]) },
      accessProfile: { findMany: jest.fn().mockResolvedValue([]) },
      node: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('excludes retired nodes from catalog products before they reach edit forms', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService(
      {
        plan: { findMany: jest.fn().mockResolvedValue([]) },
        trafficPackProduct: { findMany: jest.fn().mockResolvedValue([]) },
        accessProfile: { findMany: jest.fn().mockResolvedValue([]) },
        node: { findMany: jest.fn().mockResolvedValue([]) },
        catalogProduct: { findMany },
      } as never,
      {} as never,
    );

    await service.getAdminCatalog();

    const [query] = findMany.mock.calls[0] as unknown as [
      {
        include: {
          accessProfile: {
            include: {
              nodeBindings: {
                where?: { node: { retiredAt: null } };
              };
            };
          };
        };
      },
    ];
    expect(query.include.accessProfile.include.nodeBindings.where).toEqual({
      node: { retiredAt: null },
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

    expect(cache.del).toHaveBeenCalledWith('catalog:portal:v3');
  });

  it('returns only public plan fields for the landing page', async () => {
    const service = serviceWith({});
    jest.spyOn(service, 'getPortalCatalog').mockResolvedValue({
      products: [
        {
          id: 'product_1',
          slug: 'pro',
          kind: 'plan',
          status: 'active',
          name: 'Pro',
          description: 'Everyday plan',
          accent: 'green',
          featured: true,
          homepageVisible: true,
          purchaseLimitPerUser: null,
          purchaseLimitKey: null,
          requiresActivePlan: false,
          referralEligible: true,
          accessProfileId: 'profile_1',
          trafficReset: 'monthly',
          quotaCadence: 'monthly_reset',
          access: {
            profileName: 'Private profile name',
            speedUpMbps: 200,
            speedDownMbps: 200,
            deviceLimit: 99,
            servers: [
              {
                id: 'server_secret',
                name: 'Internal server name',
                region: 'US',
                nodes: [
                  {
                    id: 'node_secret',
                    label: 'Internal node name',
                    protocol: 'hysteria2',
                    serverId: 'server_secret',
                    serverName: 'Internal server name',
                    region: 'US',
                    provider: null,
                    lifecycleStatus: 'active',
                    priority: 0,
                    serviceable: true,
                  },
                ],
              },
            ],
            nodePools: [],
          },
          offers: [
            {
              id: 'offer_1',
              slug: 'pro-monthly',
              name: '月付',
              billingPeriod: 'monthly',
              intervalMonths: 1,
              legacyDurationDays: null,
              trafficBytes: 120 * 1024 ** 3,
              priceCents: 1690,
              storeUrl: 'https://private-store.example.com',
              currency: 'CNY',
              active: true,
              isDefault: true,
              archivedAt: null,
            },
          ],
          createdAt: '2026-08-28T00:00:00.000Z',
          updatedAt: '2026-08-28T00:00:00.000Z',
        },
      ],
      plans: [],
      trafficPacks: [],
    } as never);

    const catalog = await service.getPublicCatalog();

    expect(catalog.products[0]).toMatchObject({
      id: 'product_1',
      name: 'Pro',
      homepageVisible: true,
      access: { availableServerCount: 1, availableNodeCount: 1 },
      offers: [{ id: 'offer_1', priceCents: 1690 }],
    });
    expect(catalog.products[0]).not.toHaveProperty('access.servers');
    expect(catalog.products[0].offers[0]).not.toHaveProperty('storeUrl');
  });

  it('atomically updates the independently selected homepage products', async () => {
    const tx = {
      catalogProduct: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'plan_1' }, { id: 'plan_2' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const cache = { del: jest.fn().mockResolvedValue(undefined) };
    const service = serviceWith(tx, cache);
    jest
      .spyOn(service, 'getAdminCatalog')
      .mockResolvedValue({ products: [] } as never);

    await service.updateHomepageProducts({ productIds: ['plan_1', 'plan_2'] });

    expect(tx.catalogProduct.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['plan_1', 'plan_2'] },
        kind: 'PLAN',
        series: 'STANDARD',
        status: 'ACTIVE',
        systemManaged: false,
        offers: {
          some: {
            active: true,
            archivedAt: null,
          },
        },
      },
      select: { id: true },
    });
    expect(tx.catalogProduct.updateMany).toHaveBeenNthCalledWith(1, {
      where: { homepageVisible: true },
      data: { homepageVisible: false },
    });
    expect(tx.catalogProduct.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['plan_1', 'plan_2'] } },
      data: { homepageVisible: true },
    });
    expect(cache.del).toHaveBeenCalledWith('catalog:portal:v3');
  });

  it('rejects homepage selections containing unavailable products', async () => {
    const tx = {
      catalogProduct: {
        findMany: jest.fn().mockResolvedValue([{ id: 'plan_1' }]),
        updateMany: jest.fn(),
      },
    };
    const service = serviceWith(tx);

    await expect(
      service.updateHomepageProducts({ productIds: ['plan_1', 'draft_1'] }),
    ).rejects.toThrow(
      'Homepage products must be purchasable active standard plans',
    );
    expect(tx.catalogProduct.updateMany).not.toHaveBeenCalled();
  });
});
