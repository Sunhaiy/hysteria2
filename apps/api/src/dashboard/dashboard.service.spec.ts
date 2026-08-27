import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  it('returns one Beijing-time dashboard projection without loading entity lists', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { todayBytes: 300n, yesterdayBytes: 200n, monthBytes: 900n },
        ])
        .mockResolvedValueOnce([
          { date: '2026-08-27', txBytes: 100n, rxBytes: 200n },
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
            physicalBytes: 900n,
            onlineUsers: 3n,
            activeConnections: 7n,
            lastSeenAt: new Date('2026-08-27T11:55:00.000Z'),
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

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(7);
    expect(result.metrics).toEqual({
      todayPhysicalBytes: 300,
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
      physicalBytes: 300,
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
});
