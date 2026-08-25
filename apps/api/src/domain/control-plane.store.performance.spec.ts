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
});
