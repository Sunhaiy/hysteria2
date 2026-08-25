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
    const service = new CustomerAdminService(prisma as never);

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
    const service = new CustomerAdminService(prisma as never);

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
    const service = new CustomerAdminService(prisma as never);

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
    const service = new CustomerAdminService(prisma as never);

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
    const service = new CustomerAdminService(prisma as never);

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
    const service = new CustomerAdminService(prisma as never);

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
      const service = new CustomerAdminService(prisma as never);

      await expect(
        service.setTrafficMultiplier('user_1', multiplier, 'admin_1'),
      ).rejects.toThrow('Traffic multiplier must be 0.1 to 100');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
