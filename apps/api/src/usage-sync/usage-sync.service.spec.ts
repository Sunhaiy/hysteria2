import { UsageSyncService } from './usage-sync.service';

describe('UsageSyncService', () => {
  it('syncs traffic, clears counters afterward, and kicks restricted users', async () => {
    const store = {
      getNodes: jest.fn().mockResolvedValue([
        {
          id: 'node_hk_core',
          protocol: 'hysteria2',
          trafficApiBaseUrl: 'mock://hk-core',
          trafficApiSecret: 'stats-core',
          active: true,
        },
      ]),
      applyTrafficSnapshot: jest.fn().mockResolvedValue(['usr_lin']),
      applyOnlineSnapshot: jest.fn().mockResolvedValue(undefined),
      validateUserIsRestricted: jest.fn().mockResolvedValue(true),
      markNodeSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markNodeSyncFailure: jest.fn().mockResolvedValue(undefined),
    };

    const nodeClient = {
      fetchTraffic: jest.fn((node: { id: string }) =>
        node.id === 'node_hk_core' ? { usr_lin: { tx: 2, rx: 40 } } : {},
      ),
      clearTraffic: jest.fn(() => ({})),
      fetchOnline: jest.fn(() => ({})),
      syncUsers: jest.fn(() => ({ added: 0, removed: 0, total: 0 })),
    };

    const kickService = {
      kickUserEverywhere: jest.fn(() => ({ ok: true })),
    };

    const service = new UsageSyncService(
      store as never,
      nodeClient as never,
      kickService as never,
    );

    const result = await service.syncAllNodes();

    expect(result[0]).toMatchObject({
      nodeId: 'node_hk_core',
      impactedUsers: 1,
    });
    expect(store.applyTrafficSnapshot).toHaveBeenCalledWith('node_hk_core', {
      usr_lin: { tx: 2, rx: 40 },
    });
    expect(nodeClient.fetchTraffic.mock.invocationCallOrder[0]).toBeLessThan(
      nodeClient.clearTraffic.mock.invocationCallOrder[0],
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
      getNodes: jest.fn().mockResolvedValue([node]),
      getNodeProvisioningUsers: jest
        .fn()
        .mockResolvedValue([
          { userId: 'usr_lin', id: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1' },
        ]),
      applyTrafficSnapshot: jest.fn().mockResolvedValue([]),
      applyOnlineSnapshot: jest.fn().mockResolvedValue(undefined),
      markNodeSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markNodeSyncFailure: jest.fn().mockResolvedValue(undefined),
    };
    const nodeClient = {
      syncUsers: jest
        .fn()
        .mockResolvedValue({ added: 1, removed: 0, total: 1 }),
      fetchTraffic: jest.fn().mockResolvedValue({}),
      clearTraffic: jest.fn().mockResolvedValue({}),
      fetchOnline: jest.fn().mockResolvedValue({}),
    };
    const service = new UsageSyncService(
      store as never,
      nodeClient as never,
      { kickUserEverywhere: jest.fn() } as never,
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
});
