import { UsageSyncService } from './usage-sync.service';

describe('UsageSyncService', () => {
  it('syncs traffic, clears counters afterward, and kicks restricted users', async () => {
    const store = {
      getNodes: jest.fn().mockResolvedValue([
        {
          id: 'node_hk_core',
          trafficApiBaseUrl: 'mock://hk-core',
          trafficApiSecret: 'stats-core',
          active: true,
        },
      ]),
      applyTrafficSnapshot: jest.fn().mockResolvedValue(['usr_lin']),
      applyOnlineSnapshot: jest.fn().mockResolvedValue(undefined),
      validateUserIsRestricted: jest.fn().mockResolvedValue(true),
    };

    const nodeClient = {
      fetchTraffic: jest.fn((node: { id: string }) =>
        node.id === 'node_hk_core' ? { usr_lin: { tx: 2, rx: 40 } } : {},
      ),
      clearTraffic: jest.fn(() => ({})),
      fetchOnline: jest.fn(() => ({})),
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
  });
});
