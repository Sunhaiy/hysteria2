import { UsageSyncService } from './usage-sync.service';

describe('UsageSyncService', () => {
  it('applies and acknowledges one durable traffic batch', async () => {
    const store = {
      getNodesForControl: jest.fn().mockResolvedValue([
        {
          id: 'node_hk_core',
          protocol: 'hysteria2',
          trafficApiBaseUrl: 'mock://hk-core',
          trafficApiSecret: 'stats-core',
          active: true,
        },
      ]),
      applyTrafficBatch: jest.fn().mockResolvedValue({
        replayed: false,
        impactedUsers: ['usr_lin'],
      }),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue(undefined),
      applyOnlineSnapshot: jest.fn().mockResolvedValue(undefined),
      validateUserIsRestricted: jest.fn().mockResolvedValue(true),
      markNodeSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markNodeSyncFailure: jest.fn().mockResolvedValue(undefined),
    };

    const nodeClient = {
      claimTrafficBatch: jest.fn().mockResolvedValue({
        id: 'batch-1',
        claimedAt: '2026-08-14T00:00:00.000Z',
        traffic: { usr_lin: { tx: 2, rx: 40 } },
      }),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue({ ok: true }),
      fetchOnline: jest.fn(() => ({})),
      syncUsers: jest.fn(() => ({ added: 0, removed: 0, total: 0 })),
    };

    const kickService = {
      kickUserEverywhere: jest.fn(() => ({ ok: true })),
    };
    const entitlements = {
      applyTrafficBatch: jest.fn().mockResolvedValue({
        replayed: false,
        impactedUsers: ['usr_lin'],
      }),
      getNodeAccess: jest.fn().mockResolvedValue({ allowed: false }),
      getNodeProvisioningUsers: jest.fn().mockResolvedValue([]),
    };

    const service = new UsageSyncService(
      store as never,
      nodeClient as never,
      kickService as never,
      entitlements as never,
    );

    const result = await service.syncAllNodes();

    expect(result[0]).toMatchObject({
      nodeId: 'node_hk_core',
      impactedUsers: 1,
    });
    expect(entitlements.applyTrafficBatch).toHaveBeenCalledWith(
      'node_hk_core',
      {
        id: 'batch-1',
        claimedAt: '2026-08-14T00:00:00.000Z',
        traffic: { usr_lin: { tx: 2, rx: 40 } },
      },
    );
    expect(nodeClient.acknowledgeTrafficBatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node_hk_core' }),
      'batch-1',
    );
    expect(kickService.kickUserEverywhere).toHaveBeenCalledWith(
      'usr_lin',
      'usage-sync',
    );
    expect(store.markNodeSyncSuccess).toHaveBeenCalledWith('node_hk_core');
  });

  it('provisions VLESS users before collecting Xray statistics', async () => {
    const node = {
      id: 'node_vless',
      protocol: 'vless_reality',
      vlessFlow: 'xtls-rprx-vision',
      trafficApiBaseUrl: 'mock://vless',
      trafficApiSecret: 'secret',
      active: true,
    };
    const store = {
      getNodesForControl: jest.fn().mockResolvedValue([node]),
      getNodeProvisioningUsers: jest
        .fn()
        .mockResolvedValue([
          { userId: 'usr_lin', id: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1' },
        ]),
      applyTrafficBatch: jest.fn().mockResolvedValue({
        replayed: false,
        impactedUsers: [],
      }),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue(undefined),
      applyOnlineSnapshot: jest.fn().mockResolvedValue(undefined),
      markNodeSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markNodeSyncFailure: jest.fn().mockResolvedValue(undefined),
    };
    const nodeClient = {
      syncUsers: jest
        .fn()
        .mockResolvedValue({ added: 1, removed: 0, total: 1 }),
      claimTrafficBatch: jest.fn().mockResolvedValue({
        id: 'batch-vless',
        claimedAt: '2026-08-14T00:00:00.000Z',
        traffic: {},
      }),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue({ ok: true }),
      fetchOnline: jest.fn().mockResolvedValue({}),
    };
    const entitlements = {
      getNodeProvisioningUsers: jest
        .fn()
        .mockResolvedValue([
          { userId: 'usr_lin', id: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1' },
        ]),
      applyTrafficBatch: jest.fn().mockResolvedValue({
        replayed: false,
        impactedUsers: [],
      }),
      getNodeAccess: jest.fn().mockResolvedValue({ allowed: true }),
    };
    const service = new UsageSyncService(
      store as never,
      nodeClient as never,
      { kickUserEverywhere: jest.fn() } as never,
      entitlements as never,
    );

    const result = await service.syncAllNodes();

    expect(nodeClient.syncUsers).toHaveBeenCalledWith(node, [
      {
        userId: 'usr_lin',
        id: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
        email: 'usr_lin',
        flow: 'xtls-rprx-vision',
      },
    ]);
    expect(result[0]).toMatchObject({
      nodeId: 'node_vless',
      provisionedUsers: 1,
    });
  });

  it('serializes node syncs to preserve database capacity for user requests', async () => {
    const nodes = ['node_a', 'node_b', 'node_c'].map((id) => ({
      id,
      protocol: 'hysteria2',
      trafficApiBaseUrl: `mock://${id}`,
      trafficApiSecret: 'secret',
      active: true,
    }));
    let activeDatabaseWrites = 0;
    let maxConcurrentDatabaseWrites = 0;
    const store = {
      getNodesForControl: jest.fn().mockResolvedValue(nodes),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue(undefined),
      applyOnlineSnapshot: jest.fn().mockResolvedValue(undefined),
      markNodeSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markNodeSyncFailure: jest.fn().mockResolvedValue(undefined),
    };
    const nodeClient = {
      claimTrafficBatch: jest.fn((node: { id: string }) =>
        Promise.resolve({
          id: `batch-${node.id}`,
          claimedAt: '2026-08-24T00:00:00.000Z',
          traffic: {},
        }),
      ),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue({ ok: true }),
      fetchOnline: jest.fn().mockResolvedValue({}),
      syncUsers: jest
        .fn()
        .mockResolvedValue({ added: 0, removed: 0, total: 0 }),
    };
    const entitlements = {
      applyTrafficBatch: jest.fn(async () => {
        activeDatabaseWrites += 1;
        maxConcurrentDatabaseWrites = Math.max(
          maxConcurrentDatabaseWrites,
          activeDatabaseWrites,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeDatabaseWrites -= 1;
        return { replayed: false, impactedUsers: [] };
      }),
      getNodeAccess: jest.fn().mockResolvedValue({ allowed: true }),
      getNodeProvisioningUsers: jest.fn().mockResolvedValue([]),
    };
    const service = new UsageSyncService(
      store as never,
      nodeClient as never,
      { kickUserEverywhere: jest.fn() } as never,
      entitlements as never,
    );

    const result = await service.syncAllNodes();

    expect(result).toHaveLength(nodes.length);
    expect(maxConcurrentDatabaseWrites).toBe(1);
  });
});
