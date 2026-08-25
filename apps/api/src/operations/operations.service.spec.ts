import { OperationsService } from './operations.service';

describe('OperationsService', () => {
  afterEach(() => jest.useRealTimers());

  function createService(overrides: {
    prisma?: Record<string, unknown>;
    store?: Record<string, unknown>;
    adapters?: Record<string, unknown>;
    monitoring?: Record<string, unknown>;
    nodes?: Record<string, unknown>;
    presence?: Record<string, unknown>;
  }) {
    return new OperationsService(
      (overrides.prisma ?? {}) as never,
      (overrides.adapters ?? {}) as never,
      (overrides.monitoring ?? {}) as never,
      {} as never,
      {} as never,
      {} as never,
      (overrides.nodes ?? overrides.store ?? {}) as never,
      (overrides.presence ?? overrides.store ?? {}) as never,
    );
  }

  it('returns only fresh online presence with stable server-side pagination', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T10:00:00.000Z'));
    const observedAt = new Date('2026-08-24T09:59:50.000Z');
    const prisma = {
      onlinePresence: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'presence_2',
            userId: 'user_1',
            nodeId: 'node_1',
            concurrentClients: 2,
            observedAt,
            user: { email: 'user@example.com', displayName: 'User' },
            node: {
              label: 'HK Reality',
              hostname: 'hk.example.com',
              serverId: 'server_hk',
              protocol: 'VLESS_REALITY',
              server: { name: 'Hong Kong' },
            },
          },
        ]),
        count: jest.fn().mockResolvedValue(21),
      },
    };
    const service = createService({ prisma });

    const result = await service.presence({
      q: 'user',
      protocol: 'vless_reality',
      page: '2',
      pageSize: '20',
    });

    const [findMany] = prisma.onlinePresence.findMany.mock
      .calls[0] as unknown as [
      {
        where: Record<string, unknown>;
        orderBy: Record<string, string>[];
        skip: number;
        take: number;
      },
    ];
    expect(findMany).toMatchObject({
      where: {
        observedAt: { gte: new Date('2026-08-24T09:59:15.000Z') },
        concurrentClients: { gt: 0 },
      },
      orderBy: [
        { concurrentClients: 'desc' },
        { observedAt: 'desc' },
        { id: 'desc' },
      ],
      skip: 20,
      take: 20,
    });
    expect(result).toMatchObject({
      page: 2,
      pageSize: 20,
      total: 21,
      totalPages: 2,
      items: [
        {
          id: 'presence_2',
          protocol: 'vless_reality',
          concurrentClients: 2,
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty('ip');
  });

  it('records protocol health and collection timestamps in the current snapshot', async () => {
    const observedAt = new Date('2026-08-24T09:59:50.000Z');
    const lastSyncAt = '2026-08-24T09:59:00.000Z';
    const prisma = {
      onlinePresence: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { concurrentClients: 3 },
          _max: { observedAt },
        }),
      },
      nodeHealthSnapshot: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const store = {
      getNodesForControl: jest.fn().mockResolvedValue([
        {
          id: 'node_1',
          active: true,
          lifecycleStatus: 'active',
          protocol: 'vless_reality',
          hostname: 'hk.example.com',
          port: 443,
          trafficApiBaseUrl: 'https://agent.example.com',
          trafficApiSecret: 'secret',
          lastSyncAt,
          lastSyncError: null,
        },
      ]),
    };
    const adapters = {
      probeHealth: jest.fn().mockResolvedValue({
        agentReachable: true,
        coreHealthy: true,
        publicEndpointReachable: true,
        latencyMs: 12,
        error: null,
      }),
    };
    const monitoring = { runChecks: jest.fn().mockResolvedValue({}) };
    const service = createService({ prisma, store, adapters, monitoring });

    await expect(service.probeHealth()).resolves.toEqual([
      expect.objectContaining({ nodeId: 'node_1', healthy: true }),
    ]);
    const [snapshotCreate] = prisma.nodeHealthSnapshot.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(snapshotCreate.data).toMatchObject({
      nodeId: 'node_1',
      healthy: true,
      agentReachable: true,
      coreHealthy: true,
      publicEndpointReachable: true,
      onlineUsers: 3,
      userSyncAt: new Date(lastSyncAt),
      trafficAt: new Date(lastSyncAt),
      presenceAt: observedAt,
    });
    expect(monitoring.runChecks).toHaveBeenCalledTimes(1);
  });

  it('records a successful presence collection even when nobody is online', async () => {
    const nodes = {
      getNodesForControl: jest.fn().mockResolvedValue([
        {
          id: 'node_empty',
          active: true,
          lifecycleStatus: 'active',
          protocol: 'vless_reality',
        },
      ]),
      markPresenceSuccess: jest.fn().mockResolvedValue(undefined),
    };
    const adapters = { fetchOnline: jest.fn().mockResolvedValue({}) };
    const presence = { apply: jest.fn().mockResolvedValue({}) };
    const service = createService({ nodes, adapters, presence });

    await expect(service.collectPresence()).resolves.toEqual([
      {
        nodeId: 'node_empty',
        onlineAccounts: 0,
        onlineClients: 0,
      },
    ]);
    expect(nodes.markPresenceSuccess).toHaveBeenCalledWith('node_empty');
  });
});
