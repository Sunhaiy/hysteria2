import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  it('returns one Beijing-time dashboard projection without loading entity lists', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            date: '2026-08-27',
            nodeId: 'node_1',
            txBytes: 100n,
            rxBytes: 200n,
            physicalBytes: 350n,
            lastSeenAt: new Date('2026-08-27T11:55:00.000Z'),
          },
          {
            date: '2026-08-26',
            nodeId: 'node_1',
            txBytes: 80n,
            rxBytes: 120n,
            physicalBytes: 200n,
            lastSeenAt: new Date('2026-08-26T11:55:00.000Z'),
          },
          {
            date: '2026-08-10',
            nodeId: 'node_1',
            txBytes: 150n,
            rxBytes: 200n,
            physicalBytes: 350n,
            lastSeenAt: new Date('2026-08-10T11:55:00.000Z'),
          },
        ])
        .mockResolvedValueOnce([{ count: 18n }])
        .mockResolvedValueOnce([{ users: 3n, connections: 7n }])
        .mockResolvedValueOnce([
          {
            id: 'node_1',
            label: 'US High Speed',
            serverName: 'US High Speed',
            protocol: 'HYSTERIA2',
            active: true,
            healthy: true,
            onlineUsers: 3n,
            activeConnections: 7n,
          },
        ])
        .mockResolvedValueOnce([
          { status: 'ACTIVE', count: 18n },
          { status: 'EXPIRED', count: 2n },
        ])
        .mockResolvedValueOnce([
          { granted: true, count: 40n },
          { granted: false, count: 3n },
        ]),
    };
    const service = new DashboardService(prisma as never);

    const result = await service.summary(new Date('2026-08-27T12:00:00.000Z'));

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(6);
    const sql = prisma.$queryRaw.mock.calls.map(([query]) =>
      (query as { strings: readonly string[] }).strings.join(''),
    );
    expect(sql[0]).toContain(
      'COALESCE(r."rawBytes", r."txBytes" + r."rxBytes")',
    );
    expect(sql[0]).toContain('GROUP BY 1, 2');
    expect(sql[3]).toContain('LEFT JOIN LATERAL');
    expect(
      sql.filter((query) => query.includes('FROM "UsageRollup"')),
    ).toHaveLength(1);
    expect(result.metrics).toEqual({
      todayPhysicalBytes: 350,
      yesterdayPhysicalBytes: 200,
      monthPhysicalBytes: 900,
      activePlanSubscribers: 18,
      onlineUsers: 3,
      activeConnections: 7,
    });
    expect(result.trend).toHaveLength(14);
    expect(result.trend.at(-1)).toEqual({
      date: '2026-08-27',
      txBytes: 100,
      rxBytes: 200,
      physicalBytes: 350,
    });
    expect(result.nodes[0]).toMatchObject({
      protocol: 'hysteria2',
      physicalBytes: 900,
      onlineUsers: 3,
      activeConnections: 7,
    });
    expect(result.subscriptions).toEqual({
      active: 18,
      expired: 2,
      paused: 0,
      canceled: 0,
    });
    expect(result.auth).toEqual({ granted: 40, denied: 3 });
  });

  it('serves a fresh cached projection without running dashboard queries', async () => {
    const cached = {
      generatedAt: '2026-08-27T12:00:00.000Z',
      timezone: 'Asia/Shanghai',
      freshnessSeconds: 45,
      metrics: {
        todayPhysicalBytes: 300,
        yesterdayPhysicalBytes: 200,
        monthPhysicalBytes: 900,
        activePlanSubscribers: 18,
        onlineUsers: 3,
        activeConnections: 7,
      },
      trend: [],
      nodes: [],
      subscriptions: { active: 18, expired: 2, paused: 0, canceled: 0 },
      auth: { granted: 40, denied: 3 },
    };
    const prisma = { $queryRaw: jest.fn() };
    const cache = {
      get: jest.fn().mockResolvedValue(JSON.stringify(cached)),
      set: jest.fn(),
    };
    const service = new DashboardService(prisma as never, cache as never);

    await expect(
      service.summary(new Date('2026-08-27T12:00:30.000Z')),
    ).resolves.toEqual(cached);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
