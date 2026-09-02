import { TrafficAnalyticsService } from './traffic-analytics.service';

describe('TrafficAnalyticsService', () => {
  it('builds the overview from database aggregates without materializing rollups', async () => {
    const prisma = {
      usageRollup: {
        findMany: jest
          .fn()
          .mockRejectedValue(new Error('overview must not load rollup rows')),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            physicalBytes: 100n,
            accountedBytes: 120n,
            allocatedBytes: 110n,
            overageBytes: 10n,
            records: 4n,
          },
        ])
        .mockResolvedValueOnce([
          {
            date: '2026-08-24',
            physicalBytes: 100n,
            accountedBytes: 120n,
            allocatedBytes: 110n,
          },
        ])
        .mockResolvedValueOnce([
          { id: 'user_1', name: 'user@example.com', bytes: 120n },
        ])
        .mockResolvedValueOnce([{ id: 'product_1', name: 'Core', bytes: 110n }])
        .mockResolvedValueOnce([{ id: 'node_1', name: 'HK', bytes: 100n }]),
    };
    const service = new TrafficAnalyticsService(prisma as never);

    const result = await service.overview({
      from: '2026-08-01',
      to: '2026-08-25',
    });

    expect(prisma.usageRollup.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
    expect(result).toEqual({
      timezone: 'Asia/Shanghai',
      totals: {
        physicalBytes: 100,
        accountedBytes: 120,
        allocatedBytes: 110,
        overageBytes: 10,
        records: 4,
      },
      trend: [
        {
          date: '2026-08-24',
          physicalBytes: 100,
          accountedBytes: 120,
          allocatedBytes: 110,
        },
      ],
      rankings: {
        users: [{ id: 'user_1', name: 'user@example.com', bytes: 120 }],
        products: [{ id: 'product_1', name: 'Core', bytes: 110 }],
        nodes: [{ id: 'node_1', name: 'HK', bytes: 100 }],
      },
    });
  });

  it('groups physical traffic by server and fills every day in a Shanghai month', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          serverId: 'server_1',
          serverName: '美国新高速',
          date: '2026-02-01',
          txBytes: 100n,
          rxBytes: 300n,
          physicalBytes: 400n,
        },
        {
          serverId: 'server_1',
          serverName: '美国新高速',
          date: '2026-02-02',
          txBytes: 200n,
          rxBytes: 400n,
          physicalBytes: 600n,
        },
        {
          serverId: 'server_2',
          serverName: '美国备用节点',
          date: null,
          txBytes: 0n,
          rxBytes: 0n,
          physicalBytes: 0n,
        },
      ]),
    };
    const service = new TrafficAnalyticsService(prisma as never);

    const result = await service.serverMonthly(
      { month: '2026-02' },
      new Date('2026-02-02T04:00:00.000Z'),
    );
    expect(result).toMatchObject({
      timezone: 'Asia/Shanghai',
      month: '2026-02',
      range: {
        from: '2026-01-31T16:00:00.000Z',
        to: '2026-02-28T16:00:00.000Z',
      },
      today: '2026-02-02',
      totals: {
        txBytes: 300,
        rxBytes: 700,
        physicalBytes: 1000,
        todayPhysicalBytes: 600,
      },
      servers: [
        {
          id: 'server_2',
          name: '美国备用节点',
          txBytes: 0,
          rxBytes: 0,
          physicalBytes: 0,
        },
        {
          id: 'server_1',
          name: '美国新高速',
          txBytes: 300,
          rxBytes: 700,
          physicalBytes: 1000,
        },
      ],
    });
    expect(result.dates).toHaveLength(28);
    expect(result.servers[0].days).toHaveLength(28);
    expect(result.servers[0].days[0]).toEqual({
      date: '2026-02-01',
      txBytes: 0,
      rxBytes: 0,
      physicalBytes: 0,
    });
    expect(result.servers[1].days[2]).toEqual({
      date: '2026-02-03',
      txBytes: 0,
      rxBytes: 0,
      physicalBytes: 0,
    });
    const queryRaw = prisma.$queryRaw as jest.MockedFunction<
      (query: { strings: readonly string[] }) => Promise<unknown>
    >;
    const [query] = queryRaw.mock.calls[0] ?? [];
    const sql = query?.strings.join('') ?? '';
    expect(sql).toContain(`r."bucketStart" AT TIME ZONE 'Asia/Shanghai'`);
    expect(sql).not.toContain(`AT TIME ZONE 'UTC' AT TIME ZONE`);
  });

  it('rejects malformed server traffic months', async () => {
    const service = new TrafficAnalyticsService({
      $queryRaw: jest.fn(),
    } as never);

    await expect(service.serverMonthly({ month: '2026-13' })).rejects.toThrow(
      'Invalid traffic month',
    );
  });
});
