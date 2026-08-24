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
        .mockResolvedValueOnce([{ id: 'node_1', name: 'HK', bytes: 100n }])
        .mockResolvedValueOnce([
          { id: 'pool_1', name: 'Default', bytes: 100n },
        ]),
    };
    const service = new TrafficAnalyticsService(prisma as never);

    const result = await service.overview({
      from: '2026-08-01',
      to: '2026-08-25',
    });

    expect(prisma.usageRollup.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(6);
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
        pools: [{ id: 'pool_1', name: 'Default', bytes: 100 }],
      },
    });
  });
});
