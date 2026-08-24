import { NodeProtocol } from '@prisma/client';
import { ControlPlaneStoreService } from './control-plane.store';

describe('ControlPlaneStoreService performance-sensitive reads', () => {
  it('loads recent online snapshots per node so the composite index can be used', async () => {
    const now = new Date('2026-08-24T05:30:00.000Z');
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
          .mockImplementation(({ where }: { where: { nodeId: string } }) =>
            Promise.resolve([
              {
                userId: `user_${where.nodeId}`,
                nodeId: where.nodeId,
                concurrentClients: 1,
                capturedAt: now,
              },
            ]),
          ),
      },
    };
    const service = new ControlPlaneStoreService(prisma as never);

    const result = await service.getNodes();

    expect(result).toHaveLength(2);
    expect(prisma.onlineSnapshot.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.onlineSnapshot.findMany).toHaveBeenNthCalledWith(1, {
      where: { nodeId: 'node_a' },
      orderBy: { capturedAt: 'desc' },
      take: 200,
    });
    expect(prisma.onlineSnapshot.findMany).toHaveBeenNthCalledWith(2, {
      where: { nodeId: 'node_b' },
      orderBy: { capturedAt: 'desc' },
      take: 200,
    });
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
    const service = new ControlPlaneStoreService(prisma as never);

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
