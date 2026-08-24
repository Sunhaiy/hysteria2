import { EntitlementService } from './entitlement.service';

describe('EntitlementService V2', () => {
  afterEach(() => jest.useRealTimers());

  it('creates a clamped monthly bucket and resolves unioned access limits', async () => {
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
        poolBindings: [
          {
            priority: 0,
            pool: {
              active: true,
              members: [
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
          },
        ],
        nodeBindings: [],
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
        poolBindings: [],
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
      remainingBytes: 130,
    });
    expect(access.nodes.map((node) => node.id)).toEqual([
      'node_pack',
      'node_core',
    ]);
  });

  it('splits usage across serviceable buckets by earliest expiry', async () => {
    const early = {
      id: 'bucket_early',
      grantedBytes: 100n,
      consumedBytes: 80n,
      grant: {
        legacySubscriptionId: null,
        legacyTrafficPackId: null,
      },
    };
    const later = {
      id: 'bucket_later',
      grantedBytes: 100n,
      consumedBytes: 0n,
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
      subscription: { update: jest.fn() },
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
              OR: Array<{
                nodeBindings?: { some: { nodeId: string } };
              }>;
            };
          };
        };
        orderBy: Array<Record<string, string>>;
      },
    ];
    expect(
      bucketQuery.where.grant.accessProfile.OR.some(
        (entry) => entry.nodeBindings?.some.nodeId === 'node_core',
      ),
    ).toBe(true);
    expect(bucketQuery.orderBy).toEqual([
      { endsAt: 'asc' },
      { createdAt: 'asc' },
    ]);
    expect(tx.quotaBucket.update.mock.calls).toEqual([
      [
        {
          where: { id: 'bucket_early' },
          data: { consumedBytes: { increment: 20n } },
        },
      ],
      [
        {
          where: { id: 'bucket_later' },
          data: { consumedBytes: { increment: 30n } },
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
        create: [
          { quotaBucketId: 'bucket_early', accountedBytes: 20n },
          { quotaBucketId: 'bucket_later', accountedBytes: 30n },
        ],
      },
    });
  });
});
