import { OperationsService } from '../operations/operations.service';
import { MonitoringService } from './monitoring.service';

describe('bounded monitoring reads', () => {
  const checkedAt = new Date('2026-11-11T00:00:00Z');
  const history = {
    nodeId: 'a',
    healthy: false,
    latencyMs: 12,
    onlineUsers: 3,
    syncDelaySeconds: 9,
    checkedAt,
    error: 'unreachable',
  };
  function fixture() {
    const nodes = ['a', 'b'].map((id) => ({
      id,
      label: id,
      hostname: id,
      protocol: 'HYSTERIA2',
      lifecycleStatus: 'ACTIVE',
      lastSyncError: null,
      healthSnapshots: id === 'a' ? [history] : [],
      serviceChecks: id === 'a' ? [history] : [],
    }));
    return {
      node: { findMany: jest.fn().mockResolvedValue(nodes) },
      $queryRaw: jest.fn().mockResolvedValue([history]),
      onlinePresence: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 1 },
          _sum: { concurrentClients: 3 },
        }),
      },
      monitorAlert: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      nodeServer: { count: jest.fn().mockResolvedValue(1) },
    };
  }

  it('bounds history reads for multiple nodes in the operations summary', async () => {
    const prisma = fixture();
    const service = new OperationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.summary();
    expect(result.nodes).toEqual([
      expect.objectContaining({
        id: 'a',
        healthy: false,
        latencyMs: 12,
        checkedAt: checkedAt.toISOString(),
      }),
      expect.objectContaining({
        id: 'b',
        healthy: null,
        latencyMs: null,
        checkedAt: null,
      }),
    ]);
    const [query] = prisma.node.findMany.mock.calls[0] as [
      { include?: object },
    ];
    expect(query.include).not.toHaveProperty('healthSnapshots');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('bounds service-check reads without losing nodes that have no history', async () => {
    const prisma = fixture();
    const service = new MonitoringService(prisma as never, {} as never);
    const result = await service.overview();
    expect(result.nodes).toEqual([
      expect.objectContaining({ id: 'a', healthy: false, syncDelaySeconds: 9 }),
      expect.objectContaining({
        id: 'b',
        healthy: null,
        syncDelaySeconds: null,
      }),
    ]);
    const [query] = prisma.node.findMany.mock.calls[0] as [
      { include?: object },
    ];
    expect(query.include ?? {}).not.toHaveProperty('serviceChecks');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
