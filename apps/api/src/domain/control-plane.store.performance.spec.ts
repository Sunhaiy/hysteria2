import { NodeProtocol } from '@prisma/client';
import { ControlPlaneStoreService } from './control-plane.store';
import { NodeControlService } from './node-control.service';

describe('ControlPlaneStoreService performance-sensitive reads', () => {
  afterEach(() => jest.useRealTimers());

  it('loads current online presence once instead of scanning history per node', async () => {
    const now = new Date('2026-08-24T05:30:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const nodes = ['node_a', 'node_b'].map((id) => ({
      id,
      serverId: null,
      protocol: NodeProtocol.HYSTERIA2,
      label: id,
      hostname: `${id}.example.com`,
      port: 443,
      obfsPassword: null,
      sni: null,
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: null,
      realityShortId: null,
      realityFingerprint: null,
      realitySpiderX: null,
      vlessFlow: null,
      trafficApiBaseUrl: `https://${id}.example.com`,
      trafficApiSecret: 'encrypted',
      active: true,
      lifecycleStatus: 'ACTIVE',
      speedUpMbps: 20,
      speedDownMbps: 100,
      lastSyncAt: now,
      lastSyncError: null,
      createdAt: now,
      updatedAt: now,
    }));
    const prisma = {
      node: { findMany: jest.fn().mockResolvedValue(nodes) },
      onlineSnapshot: {
        findMany: jest
          .fn()
          .mockRejectedValue(new Error('node lists must not scan history')),
      },
      onlinePresence: {
        findMany: jest.fn().mockResolvedValue(
          nodes.map((node) => ({
            userId: `user_${node.id}`,
            nodeId: node.id,
            concurrentClients: 1,
            observedAt: now,
          })),
        ),
      },
    };
    const service = new NodeControlService(
      prisma as never,
      {
        decrypt: jest.fn((value: string) => value),
      } as never,
    );

    const result = await service.getNodes();

    expect(result).toHaveLength(2);
    expect(prisma.onlineSnapshot.findMany).not.toHaveBeenCalled();
    expect(prisma.onlinePresence.findMany).toHaveBeenCalledTimes(1);
    expect(result.map((node) => node.concurrentUsers)).toEqual([1, 1]);
  });

  it('aggregates the 14-day chart in PostgreSQL instead of loading rollup rows', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T05:30:00.000Z'));
    const prisma = {
      usageRollup: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({
            _sum: { txBytes: 12n, rxBytes: 34n },
            _count: { _all: 2 },
          })
          .mockResolvedValueOnce({ _sum: { txBytes: 2n, rxBytes: 3n } })
          .mockResolvedValueOnce({ _sum: { txBytes: 5n, rxBytes: 7n } }),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest
          .fn()
          .mockRejectedValue(new Error('rollup rows must not be materialized')),
      },
      node: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ date: '2026-08-24', txBytes: 2n, rxBytes: 3n }]),
    };
    const service = new ControlPlaneStoreService(
      prisma as never,
      {
        countForUser: jest.fn().mockResolvedValue(0),
      } as never,
    );

    const result = await service.getUsageSummary();

    expect(prisma.usageRollup.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.daily.at(-1)).toEqual({
      date: '2026-08-24',
      txBytes: 2,
      rxBytes: 3,
      totalBytes: 5,
    });
    jest.useRealTimers();
  });

  it('aggregates seven-day portal usage instead of returning only the latest raw samples', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T09:30:00.000Z'));
    const prisma = {
      subscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      trafficPack: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      usageRollup: {
        findMany: jest
          .fn()
          .mockRejectedValue(
            new Error('raw heartbeat rows must not hide usage'),
          ),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          day: '2026-09-02',
          nodeId: 'node_a',
          nodeLabel: 'US A',
          txBytes: 2_000n,
          rxBytes: 8_000n,
          accountedBytes: 21_000n,
        },
      ]),
    };
    const service = new ControlPlaneStoreService(
      prisma as never,
      { countForUser: jest.fn().mockResolvedValue(0) } as never,
    );

    const result = await service.getUsageForUser('user_1');

    expect(prisma.usageRollup.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [query] = prisma.$queryRaw.mock.calls[0] as unknown as [
      { strings: readonly string[] },
    ];
    expect(query.strings.join('')).toMatch(
      /COALESCE\(\s*rollup\."accountedBytes",\s*rollup\."txBytes" \+ rollup\."rxBytes"\s*\)/,
    );
    expect(result.recent).toEqual([
      expect.objectContaining({
        nodeId: 'node_a',
        nodeLabel: 'US A',
        bucketStart: '2026-09-02T00:00:00+08:00',
        txBytes: 2_000,
        rxBytes: 8_000,
        accountedBytes: 21_000,
        source: 'daily-aggregate',
      }),
    ]);

    const quotaOnly = await service.getUsageForUser('user_1', false);
    expect(quotaOnly.recent).toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
