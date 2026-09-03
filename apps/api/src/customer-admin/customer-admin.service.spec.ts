import { CustomerAdminService } from './customer-admin.service';

type PresenceFilter = {
  onlinePresence: {
    some: {
      concurrentClients: { gt: number };
      observedAt: { gte: Date };
    };
  };
};

type UserListQuery = {
  where: {
    subscriptions?: {
      some: {
        planId: string;
        status: string;
        endsAt: { gt: Date };
      };
    };
    onlinePresence?: PresenceFilter['onlinePresence'];
    NOT?: PresenceFilter;
    AND?: Array<Record<string, unknown>>;
  };
};

describe('CustomerAdminService list filtering', () => {
  function createListPrisma() {
    return {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
  }

  it('matches only current active subscriptions for a plan and fresh online presence', async () => {
    const prisma = createListPrisma();
    const service = new CustomerAdminService(prisma as never, {} as never);

    await service.listUsers({ planId: 'plan_1', online: 'true' });

    const [query] = prisma.user.findMany.mock.calls[0] as unknown as [
      UserListQuery,
    ];
    const subscriptionFilter = query.where.subscriptions;
    const presenceFilter = query.where.onlinePresence;
    expect(subscriptionFilter?.some.planId).toBe('plan_1');
    expect(subscriptionFilter?.some.status).toBe('ACTIVE');
    expect(subscriptionFilter?.some.endsAt.gt).toBeInstanceOf(Date);
    expect(presenceFilter?.some.concurrentClients).toEqual({ gt: 0 });
    expect(presenceFilter?.some.observedAt.gte).toBeInstanceOf(Date);
    if (!subscriptionFilter || !presenceFilter) {
      throw new Error('Expected plan and presence filters');
    }
    expect(
      subscriptionFilter.some.endsAt.gt.getTime() -
        presenceFilter.some.observedAt.gte.getTime(),
    ).toBe(45_000);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: query.where });
  });

  it('inverts the fresh-presence predicate for offline customers', async () => {
    const prisma = createListPrisma();
    const service = new CustomerAdminService(prisma as never, {} as never);

    await service.listUsers({ online: 'false' });

    const [query] = prisma.user.findMany.mock.calls[0] as unknown as [
      UserListQuery,
    ];
    expect(query.where.NOT?.onlinePresence.some.concurrentClients).toEqual({
      gt: 0,
    });
    expect(query.where.NOT?.onlinePresence.some.observedAt.gte).toBeInstanceOf(
      Date,
    );
  });

  it('matches every customer with legacy or unified plan history', async () => {
    const prisma = createListPrisma();
    const service = new CustomerAdminService(prisma as never, {} as never);

    await service.listUsers({ subscriptionHistory: 'ever' });

    const [query] = prisma.user.findMany.mock.calls[0] as unknown as [
      UserListQuery,
    ];
    expect(query.where.AND).toEqual([
      {
        OR: [
          { subscriptions: { some: {} } },
          { entitlementGrants: { some: { kind: 'PLAN' } } },
        ],
      },
    ]);
  });

  it('presents unified quota instead of stale legacy subscription totals', async () => {
    const now = new Date('2026-08-26T00:00:00.000Z');
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'user_1',
            email: 'user@example.com',
            displayName: 'User',
            role: 'MEMBER',
            status: 'ACTIVE',
            notes: null,
            balanceCents: 0,
            createdAt: now,
            updatedAt: now,
            accessTokens: [],
            accessAccount: null,
            subscriptions: [
              {
                plan: { name: 'Legacy Pro' },
                cycles: [
                  {
                    grantedBytes: 200n,
                    adjustmentBytes: 0n,
                    consumedBytes: 0n,
                  },
                ],
              },
            ],
            trafficPacks: [{ remainingBytes: 50n }],
            entitlementGrants: [
              {
                kind: 'PLAN',
                product: { name: 'Pro' },
                quotaBuckets: [{ grantedBytes: 120n, consumedBytes: 20n }],
              },
            ],
            onlinePresence: [],
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new CustomerAdminService(prisma as never, {} as never);

    const result = await service.listUsers({ q: 'user@example.com' });

    expect(result.items[0]).toMatchObject({
      remainingBytes: 100,
      activePlanNames: ['Pro'],
      activeTrafficPackCount: 0,
      quotaState: 'low',
    });
  });
});

describe('CustomerAdminService subscription links', () => {
  it('atomically revokes active links and creates a new administrator-visible link', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const created = {
      id: 'token_new',
      label: 'Primary access token',
      token: 'hy2_new_token',
      vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };
    const tx = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user_1', role: 'MEMBER' }),
      },
      accessToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        create: jest.fn().mockResolvedValue(created),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new CustomerAdminService(prisma as never, {} as never);

    const result = await service.rotateAccessToken('user_1', 'admin_1');

    const [rotation] = tx.accessToken.updateMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown>; data: { revokedAt: Date } },
    ];
    expect(rotation.where).toEqual({ userId: 'user_1', revokedAt: null });
    expect(rotation.data.revokedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      id: 'token_new',
      subscriptionUrl: 'http://localhost:4000/subscribe/hy2_new_token',
      mihomoSubscriptionUrl:
        'http://localhost:4000/subscribe/hy2_new_token/clash',
      revokedAt: null,
    });
    const [audit] = tx.auditLog.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(audit.data).toMatchObject({
      action: 'CUSTOMER_ACCESS_TOKEN_ROTATED',
      metadata: { userId: 'user_1', revokedCount: 2 },
    });
  });

  it('revokes one owned access link without deleting its audit history', async () => {
    const tx = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user_1', role: 'MEMBER' }),
      },
      accessToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new CustomerAdminService(prisma as never, {} as never);

    await service.revokeAccessToken('user_1', 'token_1', 'admin_1');

    const [revocation] = tx.accessToken.updateMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown>; data: { revokedAt: Date } },
    ];
    expect(revocation.where).toEqual({
      id: 'token_1',
      userId: 'user_1',
      revokedAt: null,
    });
    expect(revocation.data.revokedAt).toBeInstanceOf(Date);
  });
});

describe('CustomerAdminService quota policy', () => {
  it('reports the active traffic-pack multiplier when the customer has no plan', async () => {
    const now = new Date('2026-09-03T03:00:00.000Z');
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user_traffic_pack_only',
          email: 'traffic-pack@example.com',
          displayName: 'Traffic Pack User',
          status: 'ACTIVE',
          notes: null,
          balanceCents: 0,
          createdAt: now,
          updatedAt: now,
          accessAccount: {
            trafficMultiplierBasisPoints: 10_000,
            trafficMultiplierOverrideBasisPoints: null,
          },
          entitlementGrants: [
            {
              kind: 'TRAFFIC_PACK',
              trafficMultiplierBasisPointsSnapshot: 21_000,
              quotaBuckets: [
                {
                  grantedBytes: 30n * 1024n ** 3n,
                  consumedBytes: 1n,
                  trafficMultiplierBasisPointsSnapshot: 21_000,
                },
              ],
            },
          ],
          onlinePresence: [],
        }),
      },
    };
    const traffic = {
      daily: jest.fn().mockResolvedValue({ items: [] }),
    };
    const service = new CustomerAdminService(prisma as never, traffic as never);

    const result = await service.getCustomer('user_traffic_pack_only');

    expect(result).toMatchObject({
      entitlementTrafficMultiplier: 2.1,
      effectiveTrafficMultiplier: 2.1,
    });
  });

  it('sets bucket remaining quota without rewriting historical consumption', async () => {
    const bucket = {
      id: 'bucket_1',
      grantedBytes: 100n,
      consumedBytes: 20n,
      grant: { userId: 'user_1' },
    };
    const tx = {
      quotaBucket: {
        findUnique: jest.fn().mockResolvedValue(bucket),
        update: jest.fn().mockResolvedValue({
          ...bucket,
          grantedBytes: 70n,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new CustomerAdminService(prisma as never, {} as never);

    await expect(
      service.adjustQuotaBucket(
        'bucket_1',
        50,
        'Support adjustment',
        'admin_1',
      ),
    ).resolves.toMatchObject({
      grantedBytes: 70,
      consumedBytes: 20,
      remainingBytes: 50,
    });
    expect(tx.quotaBucket.update).toHaveBeenCalledWith({
      where: { id: 'bucket_1' },
      data: { grantedBytes: 70n },
    });
  });

  it.each([Number.NaN, 0.09, 100.01])(
    'rejects an invalid traffic multiplier before opening a transaction',
    async (multiplier) => {
      const prisma = { $transaction: jest.fn() };
      const service = new CustomerAdminService(prisma as never, {} as never);

      await expect(
        service.setTrafficMultiplier('user_1', multiplier, 'admin_1'),
      ).rejects.toThrow('Traffic multiplier must be 0.1 to 100');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
