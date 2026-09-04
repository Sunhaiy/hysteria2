import { EntitlementService } from './entitlement.service';

describe('EntitlementService V2', () => {
  afterEach(() => jest.useRealTimers());

  it('creates a monthly bucket for an additive permanent Ultra entitlement', async () => {
    const startsAt = new Date('2027-01-31T08:00:00.000Z');
    const endsAt = new Date('9999-12-31T23:59:59.999Z');
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_ultra_120',
          userId: 'user_1',
          kind: 'TRAFFIC_PACK',
          createdAt: startsAt,
          processedAt: startsAt,
          entitlementExpiresAt: endsAt,
          quotaCadenceSnapshot: 'MONTHLY_RESET',
          trafficBytes: 120n,
          amountCents: 6_900,
          catalogOffer: {
            id: 'offer_ultra_120',
            trafficBytes: 120n,
            product: {
              id: 'product_ultra_120',
              kind: 'TRAFFIC_PACK',
              series: 'ULTRA',
              quotaCadence: 'MONTHLY_RESET',
              accessProfileId: 'profile_ultra',
              speedUpMbps: 300,
              speedDownMbps: 300,
              defaultTrafficMultiplierBasisPoints: 10_000,
              requiresActivePlan: false,
            },
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      accessProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ deviceLimit: 1000 }),
      },
      entitlementGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'grant_ultra',
          startsAt,
          resetAnchorAt: startsAt,
        }),
      },
      quotaBucket: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const service = new EntitlementService(tx as never);

    await service.grantFromOrder({ orderId: 'order_ultra_120' }, tx as never);

    const [grantCreate] = tx.entitlementGrant.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(grantCreate.data).toMatchObject({
      quotaCadenceSnapshot: 'MONTHLY_RESET',
      resetAnchorAt: startsAt,
      priceCentsSnapshot: 6_900,
      trafficBytesSnapshot: 120n,
      activeSlot: 'ULTRA',
    });
    const [bucketUpsert] = tx.quotaBucket.upsert.mock.calls[0] as unknown as [
      { create: Record<string, unknown> },
    ];
    expect(bucketUpsert.create).toMatchObject({
      kind: 'PLAN_CYCLE',
      startsAt,
      endsAt: new Date('2027-02-28T08:00:00.000Z'),
      grantedBytes: 120n,
    });
  });

  it('upgrades the active Ultra grant and adds only the tier difference', async () => {
    const anchor = new Date('2027-01-31T08:00:00.000Z');
    const upgradedAt = new Date('2027-02-10T08:00:00.000Z');
    const endsAt = new Date('9999-12-31T23:59:59.999Z');
    const existing = {
      id: 'grant_ultra',
      productId: 'product_ultra_120',
      startsAt: anchor,
      resetAnchorAt: anchor,
      priceCentsSnapshot: 6_900,
      trafficBytesSnapshot: 120n,
    };
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_ultra_upgrade',
          userId: 'user_1',
          kind: 'TRAFFIC_PACK',
          createdAt: upgradedAt,
          processedAt: upgradedAt,
          entitlementExpiresAt: endsAt,
          quotaCadenceSnapshot: 'MONTHLY_RESET',
          trafficBytes: 360n,
          amountCents: 6_000,
          basePriceCents: 12_900,
          upgradeFromProductIdSnapshot: 'product_ultra_120',
          upgradeFromPriceCentsSnapshot: 6_900,
          catalogOffer: {
            id: 'offer_ultra_360',
            trafficBytes: 360n,
            product: {
              id: 'product_ultra_360',
              kind: 'TRAFFIC_PACK',
              series: 'ULTRA',
              quotaCadence: 'MONTHLY_RESET',
              accessProfileId: 'profile_ultra',
              speedUpMbps: 300,
              speedDownMbps: 300,
              defaultTrafficMultiplierBasisPoints: 10_000,
              requiresActivePlan: false,
            },
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      accessProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ deviceLimit: 1000 }),
      },
      entitlementGrant: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(existing),
      },
      quotaBucket: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const service = new EntitlementService(tx as never);

    await service.grantFromOrder(
      { orderId: 'order_ultra_upgrade' },
      tx as never,
    );

    const [grantUpdate] = tx.entitlementGrant.update.mock
      .calls[0] as unknown as [
      { where: { id: string }; data: Record<string, unknown> },
    ];
    expect(grantUpdate.where).toEqual({ id: 'grant_ultra' });
    expect(grantUpdate.data).toMatchObject({
      productId: 'product_ultra_360',
      resetAnchorAt: anchor,
      priceCentsSnapshot: 12_900,
      trafficBytesSnapshot: 360n,
      activeSlot: 'ULTRA',
    });
    const [bucketUpsert] = tx.quotaBucket.upsert.mock.calls[0] as unknown as [
      {
        where: { grantId_startsAt: { grantId: string; startsAt: Date } };
        update: Record<string, unknown>;
      },
    ];
    expect(bucketUpsert.where).toEqual({
      grantId_startsAt: {
        grantId: 'grant_ultra',
        startsAt: new Date('2027-01-31T08:00:00.000Z'),
      },
    });
    expect(bucketUpsert.update).toEqual({
      endsAt: new Date('2027-02-28T08:00:00.000Z'),
      grantedBytes: { increment: 240n },
    });
    expect(tx.manualOrder.update).toHaveBeenCalledWith({
      where: { id: 'order_ultra_upgrade' },
      data: {
        entitlementGrantId: 'grant_ultra',
        resetAnchorAtSnapshot: anchor,
      },
    });
  });

  it('cancels a fully refunded Ultra grant and releases its active slot', async () => {
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_ultra',
          entitlementGrant: {
            id: 'grant_ultra',
            status: 'ACTIVE',
          },
          catalogOffer: { product: { series: 'ULTRA' } },
        }),
      },
      entitlementGrant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new EntitlementService(tx as never);

    await expect(
      service.reverseUltraForFullRefund(
        tx as never,
        'order_ultra',
        'admin_1',
        'refund_1',
      ),
    ).resolves.toEqual({ reversed: true, grantId: 'grant_ultra' });

    const [grantUpdate] = tx.entitlementGrant.updateMany.mock
      .calls[0] as unknown as [
      {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      },
    ];
    expect(grantUpdate.where).toEqual({
      id: 'grant_ultra',
      status: 'ACTIVE',
      activeSlot: 'ULTRA',
    });
    expect(grantUpdate.data).toMatchObject({
      status: 'CANCELED',
      activeSlot: null,
    });
    expect(grantUpdate.data.endsAt).toBeInstanceOf(Date);
  });

  it('denies an exhausted node even when another node has usable Ultra quota', async () => {
    const normalGrant = {
      id: 'grant_normal',
      kind: 'PLAN',
      startsAt: new Date('2027-01-01T00:00:00.000Z'),
      endsAt: new Date('2028-01-01T00:00:00.000Z'),
      speedUpMbpsSnapshot: 50,
      speedDownMbpsSnapshot: 100,
      deviceLimitSnapshot: 1000,
      quotaCadenceSnapshot: 'MONTHLY_RESET',
      quotaBuckets: [{ grantedBytes: 100n, consumedBytes: 100n }],
      product: { name: '普通套餐', requiresActivePlan: false },
      accessProfile: {
        nodeBindings: [
          {
            priority: 0,
            node: {
              id: 'node_normal',
              label: '普通节点',
              active: true,
              lifecycleStatus: 'ACTIVE',
              region: 'US',
            },
          },
        ],
      },
    };
    const ultraGrant = {
      ...normalGrant,
      id: 'grant_ultra',
      kind: 'TRAFFIC_PACK',
      speedUpMbpsSnapshot: 300,
      speedDownMbpsSnapshot: 300,
      quotaBuckets: [{ grantedBytes: 120n, consumedBytes: 20n }],
      product: { name: '普通线路 Ultra 120', requiresActivePlan: false },
      accessProfile: {
        nodeBindings: [
          {
            priority: 0,
            node: {
              id: 'node_ultra',
              label: 'Ultra 节点',
              active: true,
              lifecycleStatus: 'ACTIVE',
              region: 'US',
            },
          },
        ],
      },
    };
    const prisma = {
      entitlementGrant: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([normalGrant, ultraGrant])
          .mockResolvedValueOnce([normalGrant, ultraGrant])
          .mockResolvedValueOnce([normalGrant, ultraGrant])
          .mockResolvedValueOnce([normalGrant, ultraGrant]),
      },
      quotaBucket: { upsert: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
        }),
      },
    };
    const service = new EntitlementService(prisma as never);

    await expect(
      service.resolveAccess('user_1', 'node_normal'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'traffic_exhausted',
    });
    await expect(
      service.resolveAccess('user_1', 'node_ultra'),
    ).resolves.toMatchObject({
      allowed: true,
      speedUpMbps: 300,
      speedDownMbps: 300,
      remainingBytes: 100,
    });
  });

  it('applies product speed and default multiplier when granting a plan', async () => {
    const startsAt = new Date('2026-08-24T12:00:00.000Z');
    const endsAt = new Date('2026-09-24T12:00:00.000Z');
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_1',
          userId: 'user_1',
          createdAt: startsAt,
          processedAt: startsAt,
          entitlementExpiresAt: endsAt,
          catalogOffer: {
            id: 'offer_1',
            trafficBytes: 100n,
            product: {
              id: 'product_1',
              kind: 'PLAN',
              accessProfileId: 'profile_1',
              speedUpMbps: 35,
              speedDownMbps: 180,
              defaultTrafficMultiplierBasisPoints: 15_000,
            },
          },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'account_1',
          trafficMultiplierBasisPoints: 10_000,
          trafficMultiplierOverrideBasisPoints: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      accessProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ deviceLimit: 4 }),
      },
      entitlementGrant: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: 'grant_1',
          startsAt,
        }),
      },
      quotaBucket: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const service = new EntitlementService(tx as never);

    await service.grantFromOrder({ orderId: 'order_1' }, tx as never);

    expect(tx.accessAccount.update).toHaveBeenCalledWith({
      where: { id: 'account_1' },
      data: { trafficMultiplierBasisPoints: 15_000 },
    });
    const [grantCreate] = tx.entitlementGrant.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(grantCreate.data).toMatchObject({
      speedUpMbpsSnapshot: 35,
      speedDownMbpsSnapshot: 180,
      deviceLimitSnapshot: 4,
    });
  });

  it('starts a new quota bucket when a plan CDK switches an existing subscription', async () => {
    const previousStartsAt = new Date('2026-08-30T04:33:35.000Z');
    const startsAt = new Date('2026-08-31T04:19:48.000Z');
    const endsAt = new Date('2026-09-30T04:19:48.000Z');
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_pro_cdk',
          userId: 'user_1',
          kind: 'RENEWAL',
          createdAt: startsAt,
          processedAt: startsAt,
          entitlementExpiresAt: endsAt,
          trafficBytes: 120n,
          catalogOffer: {
            id: 'offer_pro_monthly',
            trafficBytes: 120n,
            product: {
              id: 'product_pro',
              kind: 'PLAN',
              accessProfileId: 'profile_pro',
              speedUpMbps: 35,
              speedDownMbps: 180,
              defaultTrafficMultiplierBasisPoints: 10_000,
            },
          },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      accessProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ deviceLimit: 4 }),
      },
      entitlementGrant: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'grant_existing',
          productId: 'product_go',
          startsAt: previousStartsAt,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'grant_existing',
          productId: 'product_pro',
          startsAt,
        }),
      },
      quotaBucket: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const service = new EntitlementService(tx as never);

    await service.grantFromOrder(
      { orderId: 'order_pro_cdk', subscriptionId: 'subscription_1' },
      tx as never,
    );

    const [grantUpdate] = tx.entitlementGrant.update.mock
      .calls[0] as unknown as [{ data: { startsAt?: Date } }];
    expect(grantUpdate.data.startsAt).toEqual(startsAt);
    expect(tx.quotaBucket.upsert).toHaveBeenCalledWith({
      where: {
        grantId_startsAt: { grantId: 'grant_existing', startsAt },
      },
      create: {
        grantId: 'grant_existing',
        kind: 'PLAN_CYCLE',
        startsAt,
        endsAt,
        grantedBytes: 120n,
        trafficMultiplierBasisPointsSnapshot: 10_000,
      },
      update: { endsAt },
    });
  });

  it('inherits limits from an active legacy plan when granting an add-on', async () => {
    const startsAt = new Date('2026-08-24T12:00:00.000Z');
    const endsAt = new Date('2027-08-24T12:00:00.000Z');
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_pack',
          userId: 'user_1',
          kind: 'TRAFFIC_PACK',
          createdAt: startsAt,
          processedAt: startsAt,
          entitlementExpiresAt: endsAt,
          trafficMultiplierBasisPointsSnapshot: 21_000,
          catalogOffer: {
            id: 'offer_pack',
            trafficBytes: 100n,
            product: {
              id: 'product_pack',
              kind: 'TRAFFIC_PACK',
              accessProfileId: 'profile_pack',
              speedUpMbps: 0,
              speedDownMbps: 0,
              defaultTrafficMultiplierBasisPoints: 17_000,
              requiresActivePlan: true,
            },
          },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      entitlementGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'grant_pack', startsAt }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'subscription_legacy',
          speedUpMbpsSnapshot: 120,
          speedDownMbpsSnapshot: 300,
          deviceLimitSnapshot: 1000,
          plan: {
            accessProfileId: 'profile_legacy_plan',
            catalogProduct: null,
          },
        }),
      },
      accessProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ deviceLimit: 1000 }),
      },
      quotaBucket: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const service = new EntitlementService(tx as never);

    await service.grantFromOrder(
      { orderId: 'order_pack', trafficPackId: 'pack_legacy' },
      tx as never,
    );

    const [grantCreate] = tx.entitlementGrant.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(grantCreate.data).toMatchObject({
      accessProfileId: 'profile_legacy_plan',
      speedUpMbpsSnapshot: 120,
      speedDownMbpsSnapshot: 300,
      deviceLimitSnapshot: 1000,
      trafficMultiplierBasisPointsSnapshot: 21_000,
    });
  });

  it('creates a clamped monthly bucket and resolves directly bound access limits', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-03-30T08:00:00.000Z'));
    const anchor = new Date('2027-01-31T08:00:00.000Z');
    const entitlementEnd = new Date('2027-12-31T08:00:00.000Z');
    const planGrant = {
      id: 'grant_plan',
      kind: 'PLAN',
      startsAt: anchor,
      endsAt: entitlementEnd,
      speedUpMbpsSnapshot: 20,
      speedDownMbpsSnapshot: 120,
      deviceLimitSnapshot: 3,
      offer: { trafficBytes: 100n },
      quotaBuckets: [{ grantedBytes: 100n, consumedBytes: 20n }],
      product: { name: 'Core 200' },
      accessProfile: {
        nodeBindings: [
          {
            priority: 10,
            node: {
              id: 'node_core',
              label: 'Core node',
              active: true,
              lifecycleStatus: 'ACTIVE',
              region: 'HK',
            },
          },
        ],
      },
    };
    const packGrant = {
      id: 'grant_pack',
      kind: 'TRAFFIC_PACK',
      startsAt: new Date('2027-03-01T08:00:00.000Z'),
      endsAt: new Date('2027-06-01T08:00:00.000Z'),
      speedUpMbpsSnapshot: 40,
      speedDownMbpsSnapshot: 240,
      deviceLimitSnapshot: 5,
      offer: { trafficBytes: 50n },
      quotaBuckets: [{ grantedBytes: 50n, consumedBytes: 0n }],
      product: { name: 'Flex pack' },
      accessProfile: {
        nodeBindings: [
          {
            priority: 1,
            node: {
              id: 'node_pack',
              label: 'Pack node',
              active: true,
              lifecycleStatus: 'ACTIVE',
              region: 'SG',
            },
          },
        ],
      },
    };
    const prisma = {
      entitlementGrant: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([planGrant])
          .mockResolvedValueOnce([planGrant, packGrant]),
      },
      quotaBucket: { upsert: jest.fn().mockResolvedValue({}) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user_1', status: 'ACTIVE' }),
      },
    };
    const service = new EntitlementService(prisma as never);

    const access = await service.resolveAccess('user_1');

    const [bucketUpsert] = prisma.quotaBucket.upsert.mock
      .calls[0] as unknown as [
      {
        where: { grantId_startsAt: { grantId: string; startsAt: Date } };
        create: { endsAt: Date; grantedBytes: bigint };
      },
    ];
    expect(bucketUpsert.where).toEqual({
      grantId_startsAt: {
        grantId: 'grant_plan',
        startsAt: new Date('2027-02-28T08:00:00.000Z'),
      },
    });
    expect(bucketUpsert.create).toMatchObject({
      endsAt: new Date('2027-03-31T08:00:00.000Z'),
      grantedBytes: 100n,
    });
    expect(access).toMatchObject({
      allowed: true,
      speedUpMbps: 40,
      speedDownMbps: 240,
      deviceLimit: 5,
      totalBytes: 150,
      consumedBytes: 20,
      remainingBytes: 130,
    });
    expect(access.nodes.map((node) => node.id)).toEqual([
      'node_pack',
      'node_core',
    ]);
  });

  it('reports exhausted plan usage while authorizing an active permanent pack', async () => {
    const coreNode = {
      id: 'node_core',
      label: 'Core node',
      active: true,
      lifecycleStatus: 'ACTIVE',
      region: 'US',
    };
    const grant = (
      id: string,
      kind: 'PLAN' | 'TRAFFIC_PACK',
      consumedBytes: bigint,
    ) => ({
      id,
      kind,
      endsAt: new Date('9999-12-31T23:59:59.999Z'),
      speedUpMbpsSnapshot: 100,
      speedDownMbpsSnapshot: 300,
      deviceLimitSnapshot: 1000,
      quotaBuckets: [{ grantedBytes: 100n, consumedBytes }],
      product: {
        name: kind === 'PLAN' ? 'Core plan' : 'Permanent pack',
        requiresActivePlan: false,
      },
      accessProfile: {
        nodeBindings: [{ priority: 0, node: coreNode }],
      },
    });
    const prisma = {
      entitlementGrant: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            grant('grant_plan', 'PLAN', 100n),
            grant('grant_pack', 'TRAFFIC_PACK', 50n),
          ]),
      },
      quotaBucket: { upsert: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
        }),
      },
    };
    const service = new EntitlementService(prisma as never);

    await expect(service.resolveAccess('user_1')).resolves.toMatchObject({
      allowed: true,
      totalBytes: 200,
      consumedBytes: 150,
      remainingBytes: 50,
      grants: [{ id: 'grant_pack', kind: 'traffic_pack' }],
      nodes: [{ id: 'node_core' }],
    });
  });

  it('spends plan quota before an earlier-expiring traffic pack', async () => {
    const early = {
      id: 'bucket_early',
      endsAt: new Date('2027-04-01T00:00:00.000Z'),
      createdAt: new Date('2027-03-01T00:00:00.000Z'),
      grantedBytes: 100n,
      consumedBytes: 80n,
      grant: {
        kind: 'TRAFFIC_PACK',
        legacySubscriptionId: null,
        legacyTrafficPackId: null,
        product: { requiresActivePlan: true },
      },
    };
    const later = {
      id: 'bucket_later',
      endsAt: new Date('2027-05-01T00:00:00.000Z'),
      createdAt: new Date('2027-03-02T00:00:00.000Z'),
      grantedBytes: 100n,
      consumedBytes: 0n,
      grant: {
        kind: 'PLAN',
        legacySubscriptionId: null,
        legacyTrafficPackId: null,
        product: { requiresActivePlan: false },
      },
    };
    const tx = {
      usageImportBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'batch_db_1' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }),
      },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'account_1',
          trafficMultiplierBasisPoints: 10_000,
          trafficMultiplierRemainder: 0,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      quotaBucket: {
        findMany: jest.fn().mockResolvedValue([early, later]),
        update: jest.fn().mockResolvedValue({}),
      },
      trafficPack: { findUnique: jest.fn(), update: jest.fn() },
      subscriptionCycle: { findFirst: jest.fn(), update: jest.fn() },
      entitlementGrant: { count: jest.fn().mockResolvedValue(1) },
      subscription: { count: jest.fn(), update: jest.fn() },
      usageRollup: { create: jest.fn().mockResolvedValue({ id: 'usage_1' }) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new EntitlementService(prisma as never);

    await expect(
      service.applyUsageBatch('node_core', {
        id: 'external_batch_1',
        claimedAt: '2027-03-30T08:00:00.000Z',
        traffic: { user_1: { tx: 25, rx: 25 } },
      }),
    ).resolves.toEqual({ replayed: false, impactedUsers: ['user_1'] });

    const [bucketQuery] = tx.quotaBucket.findMany.mock.calls[0] as unknown as [
      {
        where: {
          grant: {
            accessProfile: {
              nodeBindings: {
                some: {
                  nodeId: string;
                  node: { active: boolean; lifecycleStatus: string };
                };
              };
            };
          };
        };
        orderBy: Array<Record<string, string>>;
      },
    ];
    expect(bucketQuery.where.grant.accessProfile.nodeBindings).toEqual({
      some: {
        nodeId: 'node_core',
        node: { active: true, lifecycleStatus: 'ACTIVE' },
      },
    });
    expect(bucketQuery.orderBy).toEqual([
      { endsAt: 'asc' },
      { createdAt: 'asc' },
    ]);
    expect(tx.quotaBucket.update.mock.calls).toEqual([
      [
        {
          where: { id: 'bucket_later' },
          data: { consumedBytes: { increment: 50n } },
        },
      ],
    ]);
    const [usageCreate] = tx.usageRollup.create.mock.calls[0] as unknown as [
      {
        data: {
          accountedBytes: bigint;
          overageBytes: bigint;
          allocations: {
            create: Array<{ quotaBucketId: string; accountedBytes: bigint }>;
          };
        };
      },
    ];
    expect(usageCreate.data).toMatchObject({
      accountedBytes: 50n,
      overageBytes: 0n,
      allocations: {
        create: [{ quotaBucketId: 'bucket_later', accountedBytes: 50n }],
      },
    });
  });

  it('pauses a dependent add-on after plan expiry and resumes after renewal', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-03-30T08:00:00.000Z'));
    const packGrant = {
      id: 'grant_pack',
      kind: 'TRAFFIC_PACK',
      startsAt: new Date('2027-03-01T00:00:00.000Z'),
      endsAt: new Date('2028-03-01T00:00:00.000Z'),
      speedUpMbpsSnapshot: 100,
      speedDownMbpsSnapshot: 300,
      deviceLimitSnapshot: 1000,
      quotaBuckets: [{ grantedBytes: 100n, consumedBytes: 0n }],
      product: { name: '100GB 流量包', requiresActivePlan: true },
      accessProfile: {
        nodeBindings: [
          {
            priority: 0,
            node: {
              id: 'node_core',
              label: 'Core node',
              active: true,
              lifecycleStatus: 'ACTIVE',
              region: 'US',
            },
          },
        ],
      },
    };
    const prisma = {
      entitlementGrant: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([packGrant])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([packGrant]),
      },
      subscription: {
        count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
      },
      quotaBucket: { upsert: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_1',
          status: 'ACTIVE',
        }),
      },
    };
    const service = new EntitlementService(prisma as never);

    await expect(service.resolveAccess('user_1')).resolves.toMatchObject({
      allowed: false,
      reason: 'traffic_exhausted',
    });
    await expect(service.resolveAccess('user_1')).resolves.toMatchObject({
      allowed: true,
      remainingBytes: 100,
      nodes: [{ id: 'node_core' }],
    });
  });

  it.each([
    {
      productMultiplierBasisPoints: 20_000,
      userMultiplierBasisPoints: 15_000,
      expectedAccountedBytes: 200n,
    },
    {
      productMultiplierBasisPoints: 15_000,
      userMultiplierBasisPoints: 20_000,
      expectedAccountedBytes: 200n,
    },
  ])(
    'charges usage with the higher product or user multiplier',
    async ({
      productMultiplierBasisPoints,
      userMultiplierBasisPoints,
      expectedAccountedBytes,
    }) => {
      const bucket = {
        id: 'bucket_1',
        grantedBytes: 1_000n,
        consumedBytes: 0n,
        trafficMultiplierBasisPointsSnapshot: productMultiplierBasisPoints,
        grant: {
          legacySubscriptionId: null,
          legacyTrafficPackId: null,
        },
      };
      const tx = {
        usageImportBatch: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'batch_db_1' }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: 'user_1' }),
        },
        accessAccount: {
          upsert: jest.fn().mockResolvedValue({
            id: 'account_1',
            trafficMultiplierBasisPoints: productMultiplierBasisPoints,
            trafficMultiplierOverrideBasisPoints: userMultiplierBasisPoints,
            trafficMultiplierRemainder: 0,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        quotaBucket: {
          findMany: jest.fn().mockResolvedValue([bucket]),
          update: jest.fn().mockResolvedValue({}),
        },
        trafficPack: { findUnique: jest.fn(), update: jest.fn() },
        subscriptionCycle: { findFirst: jest.fn(), update: jest.fn() },
        subscription: { update: jest.fn() },
        usageRollup: { create: jest.fn().mockResolvedValue({ id: 'usage_1' }) },
      };
      const prisma = {
        $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
          operation(tx),
        ),
      };
      const service = new EntitlementService(prisma as never);

      await service.applyUsageBatch('node_core', {
        id: `batch-${productMultiplierBasisPoints}-${userMultiplierBasisPoints}`,
        claimedAt: '2027-03-30T08:00:00.000Z',
        traffic: { user_1: { tx: 40, rx: 60 } },
      });

      expect(tx.quotaBucket.update).toHaveBeenCalledWith({
        where: { id: 'bucket_1' },
        data: { consumedBytes: { increment: expectedAccountedBytes } },
      });
      const [createRollup] = tx.usageRollup.create.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ];
      expect(createRollup.data).toMatchObject({
        rawBytes: 100n,
        accountedBytes: expectedAccountedBytes,
        multiplierBasisPoints: Math.max(
          productMultiplierBasisPoints,
          userMultiplierBasisPoints,
        ),
      });
    },
  );

  it('charges a traffic-pack bucket with its purchase multiplier snapshot', async () => {
    const physicalBytes = 20_538_376n;
    const expectedAccountedBytes = 43_130_589n;
    const bucket = {
      id: 'bucket_pack_21x',
      grantedBytes: 100_000_000n,
      consumedBytes: 0n,
      trafficMultiplierBasisPointsSnapshot: 21_000,
      endsAt: new Date('2027-05-01T00:00:00.000Z'),
      createdAt: new Date('2027-03-01T00:00:00.000Z'),
      grant: {
        kind: 'TRAFFIC_PACK',
        trafficMultiplierBasisPointsSnapshot: 21_000,
        legacySubscriptionId: null,
        legacyTrafficPackId: null,
        product: { requiresActivePlan: false },
      },
    };
    const tx = {
      usageImportBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'batch_db_pack_21x' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user_pack_21x' }),
      },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'account_pack_21x',
          trafficMultiplierBasisPoints: 10_000,
          trafficMultiplierOverrideBasisPoints: null,
          trafficMultiplierRemainder: 0,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      quotaBucket: {
        findMany: jest.fn().mockResolvedValue([bucket]),
        update: jest.fn().mockResolvedValue({}),
      },
      trafficPack: { findUnique: jest.fn(), update: jest.fn() },
      subscriptionCycle: { findFirst: jest.fn(), update: jest.fn() },
      subscription: { count: jest.fn(), update: jest.fn() },
      usageRollup: { create: jest.fn().mockResolvedValue({ id: 'usage_21x' }) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new EntitlementService(prisma as never);

    await service.applyUsageBatch('node_core', {
      id: 'batch-pack-21x',
      claimedAt: '2027-03-30T08:00:00.000Z',
      traffic: {
        user_pack_21x: {
          tx: Number(physicalBytes),
          rx: 0,
        },
      },
    });

    expect(tx.quotaBucket.update).toHaveBeenCalledWith({
      where: { id: 'bucket_pack_21x' },
      data: { consumedBytes: { increment: expectedAccountedBytes } },
    });
    expect(tx.accessAccount.update).toHaveBeenCalledWith({
      where: { id: 'account_pack_21x' },
      data: { trafficMultiplierRemainder: 6_000 },
    });
    const [createRollup] = tx.usageRollup.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(createRollup.data).toMatchObject({
      rawBytes: physicalBytes,
      accountedBytes: expectedAccountedBytes,
      multiplierBasisPoints: 21_000,
      overageBytes: 0n,
    });
  });

  it('applies each entitlement multiplier when one batch crosses quota buckets', async () => {
    const buckets = [
      {
        id: 'bucket_pack',
        grantedBytes: 1_000n,
        consumedBytes: 0n,
        trafficMultiplierBasisPointsSnapshot: 21_000,
        endsAt: new Date('2027-04-01T00:00:00.000Z'),
        createdAt: new Date('2027-03-01T00:00:00.000Z'),
        grant: {
          kind: 'TRAFFIC_PACK',
          trafficMultiplierBasisPointsSnapshot: 21_000,
          legacySubscriptionId: null,
          legacyTrafficPackId: null,
          product: { requiresActivePlan: false },
        },
      },
      {
        id: 'bucket_plan',
        grantedBytes: 50n,
        consumedBytes: 0n,
        trafficMultiplierBasisPointsSnapshot: 10_000,
        endsAt: new Date('2027-05-01T00:00:00.000Z'),
        createdAt: new Date('2027-03-02T00:00:00.000Z'),
        grant: {
          kind: 'PLAN',
          trafficMultiplierBasisPointsSnapshot: 10_000,
          legacySubscriptionId: null,
          legacyTrafficPackId: null,
          product: { requiresActivePlan: false },
        },
      },
    ];
    const tx = {
      usageImportBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'batch_db_mixed' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user_mixed' }) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'account_mixed',
          trafficMultiplierBasisPoints: 10_000,
          trafficMultiplierOverrideBasisPoints: null,
          trafficMultiplierRemainder: 0,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      quotaBucket: {
        findMany: jest.fn().mockResolvedValue(buckets),
        update: jest.fn().mockResolvedValue({}),
      },
      trafficPack: { findUnique: jest.fn(), update: jest.fn() },
      subscriptionCycle: { findFirst: jest.fn(), update: jest.fn() },
      subscription: { count: jest.fn(), update: jest.fn() },
      usageRollup: {
        create: jest.fn().mockResolvedValue({ id: 'usage_mixed' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new EntitlementService(prisma as never);

    await service.applyUsageBatch('node_core', {
      id: 'batch-mixed',
      claimedAt: '2027-03-30T08:00:00.000Z',
      traffic: { user_mixed: { tx: 100, rx: 0 } },
    });

    expect(tx.quotaBucket.update.mock.calls).toEqual([
      [
        {
          where: { id: 'bucket_plan' },
          data: { consumedBytes: { increment: 50n } },
        },
      ],
      [
        {
          where: { id: 'bucket_pack' },
          data: { consumedBytes: { increment: 105n } },
        },
      ],
    ]);
    const [createRollup] = tx.usageRollup.create.mock.calls[0] as unknown as [
      {
        data: {
          accountedBytes: bigint;
          multiplierBasisPoints: number;
          overageBytes: bigint;
          allocations: {
            create: Array<{ quotaBucketId: string; accountedBytes: bigint }>;
          };
        };
      },
    ];
    expect(createRollup.data).toMatchObject({
      accountedBytes: 155n,
      multiplierBasisPoints: 15_500,
      overageBytes: 0n,
      allocations: {
        create: [
          { quotaBucketId: 'bucket_plan', accountedBytes: 50n },
          { quotaBucketId: 'bucket_pack', accountedBytes: 105n },
        ],
      },
    });
  });

  it('keeps the node entitlement multiplier when a batch exceeds its remaining quota', async () => {
    const bucket = {
      id: 'bucket_ultra',
      grantedBytes: 50n,
      consumedBytes: 0n,
      trafficMultiplierBasisPointsSnapshot: 10_000,
      endsAt: new Date('2027-05-01T00:00:00.000Z'),
      createdAt: new Date('2027-03-01T00:00:00.000Z'),
      grant: {
        kind: 'TRAFFIC_PACK',
        legacySubscriptionId: null,
        legacyTrafficPackId: null,
        product: { requiresActivePlan: false },
      },
    };
    const tx = {
      usageImportBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'batch_db_ultra_boundary' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user_ultra' }) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'account_ultra',
          trafficMultiplierBasisPoints: 21_000,
          trafficMultiplierOverrideBasisPoints: null,
          trafficMultiplierRemainder: 0,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      quotaBucket: {
        findMany: jest.fn().mockResolvedValue([bucket]),
        update: jest.fn().mockResolvedValue({}),
      },
      trafficPack: { findUnique: jest.fn(), update: jest.fn() },
      subscriptionCycle: { findFirst: jest.fn(), update: jest.fn() },
      subscription: { count: jest.fn(), update: jest.fn() },
      usageRollup: {
        create: jest.fn().mockResolvedValue({ id: 'usage_ultra_boundary' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new EntitlementService(prisma as never);

    await service.applyUsageBatch('node_ultra', {
      id: 'batch-ultra-boundary',
      claimedAt: '2027-03-30T08:00:00.000Z',
      traffic: { user_ultra: { tx: 100, rx: 0 } },
    });

    const [createRollup] = tx.usageRollup.create.mock.calls[0] as unknown as [
      {
        data: {
          accountedBytes: bigint;
          multiplierBasisPoints: number;
          overageBytes: bigint;
        };
      },
    ];
    expect(createRollup.data).toMatchObject({
      accountedBytes: 100n,
      multiplierBasisPoints: 10_000,
      overageBytes: 50n,
    });
  });
});
