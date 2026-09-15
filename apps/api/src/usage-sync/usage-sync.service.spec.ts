import { UsageSyncService } from './usage-sync.service';
import { QuotaEnforcementService } from '../kick-service/quota-enforcement.service';

describe('UsageSyncService', () => {
  it('does not let an in-flight fast pass swallow the full permission refresh', async () => {
    const node = { id: 'vless', protocol: 'vless_reality', active: true };
    const store = {
      getNodesForControl: jest.fn().mockResolvedValue([node]),
      acknowledgeTrafficBatch: jest.fn(),
      markUserSyncSuccess: jest.fn(),
      markTrafficSyncSuccess: jest.fn(),
      markSyncFailure: jest.fn(),
    };
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const client = {
      claimTrafficBatch: jest
        .fn()
        .mockImplementationOnce(async () => {
          await blocked;
          return { id: 'fast', traffic: {} };
        })
        .mockResolvedValue({ id: 'full', traffic: {} }),
      acknowledgeTrafficBatch: jest.fn(),
      syncUsers: jest.fn(),
    };
    const enforcement = new QuotaEnforcementService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const service = new UsageSyncService(
      store as never,
      client as never,
      enforcement,
      {
        applyTrafficBatch: jest.fn().mockResolvedValue({ impactedUsers: [] }),
        getNodeProvisioningUsers: jest.fn().mockResolvedValue([]),
      } as never,
      store as never,
    );
    const fast = service.syncTrafficNodes();
    await new Promise((r) => setImmediate(r));
    const full = service.syncAllNodes();
    release();
    await Promise.all([fast, full]);
    expect(client.claimTrafficBatch).toHaveBeenCalledTimes(2);
    expect(client.syncUsers).toHaveBeenCalledTimes(1);
  });
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
      markUserSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markTrafficSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markSyncFailure: jest.fn().mockResolvedValue(undefined),
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
      withNodeLock: (_id: string, work: () => Promise<unknown>) => work(),
      enqueue: jest.fn(() => ({ ok: true })),
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
      store as never,
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
    expect(kickService.enqueue).toHaveBeenCalledWith('usr_lin', 'node_hk_core');
    expect(store.markUserSyncSuccess).toHaveBeenCalledWith('node_hk_core');
    expect(store.markTrafficSyncSuccess).toHaveBeenCalledWith('node_hk_core');
  });

  it('meters Xray before refreshing permissions so provisioning cannot hide usage', async () => {
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
      markUserSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markTrafficSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markSyncFailure: jest.fn().mockResolvedValue(undefined),
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
      {
        withNodeLock: (_id: string, work: () => Promise<unknown>) => work(),
        enqueue: jest.fn(),
      } as never,
      entitlements as never,
      store as never,
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
    expect(
      nodeClient.claimTrafficBatch.mock.invocationCallOrder[0],
    ).toBeLessThan(nodeClient.syncUsers.mock.invocationCallOrder[0]);
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
      markUserSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markTrafficSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markSyncFailure: jest.fn().mockResolvedValue(undefined),
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
      {
        withNodeLock: (_id: string, work: () => Promise<unknown>) => work(),
        enqueue: jest.fn(),
      } as never,
      entitlements as never,
      store as never,
    );

    const result = await service.syncAllNodes();

    expect(result).toHaveLength(nodes.length);
    expect(maxConcurrentDatabaseWrites).toBe(1);
  });

  it('serializes post-import access checks to avoid flooding the database pool', async () => {
    const node = {
      id: 'node_hk_core',
      protocol: 'hysteria2',
      trafficApiBaseUrl: 'mock://hk-core',
      trafficApiSecret: 'secret',
      active: true,
    };
    let activeAccessChecks = 0;
    let maxConcurrentAccessChecks = 0;
    const store = {
      getNodesForControl: jest.fn().mockResolvedValue([node]),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue(undefined),
      applyOnlineSnapshot: jest.fn().mockResolvedValue(undefined),
      markUserSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markTrafficSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markSyncFailure: jest.fn().mockResolvedValue(undefined),
    };
    const nodeClient = {
      claimTrafficBatch: jest.fn().mockResolvedValue({
        id: 'batch-access-checks',
        claimedAt: '2026-08-24T00:00:00.000Z',
        traffic: {},
      }),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue({ ok: true }),
      fetchOnline: jest.fn().mockResolvedValue({}),
      syncUsers: jest
        .fn()
        .mockResolvedValue({ added: 0, removed: 0, total: 0 }),
    };
    const entitlements = {
      applyTrafficBatch: jest.fn().mockResolvedValue({
        replayed: false,
        impactedUsers: ['user_a', 'user_b', 'user_c'],
      }),
      getNodeAccess: jest.fn(async () => {
        activeAccessChecks += 1;
        maxConcurrentAccessChecks = Math.max(
          maxConcurrentAccessChecks,
          activeAccessChecks,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeAccessChecks -= 1;
        return { allowed: true };
      }),
      getNodeProvisioningUsers: jest.fn().mockResolvedValue([]),
    };
    const service = new UsageSyncService(
      store as never,
      nodeClient as never,
      {
        withNodeLock: (_id: string, work: () => Promise<unknown>) => work(),
        enqueue: jest.fn(),
      } as never,
      entitlements as never,
      store as never,
    );

    await service.syncAllNodes();

    expect(entitlements.getNodeAccess).toHaveBeenCalledTimes(3);
    expect(maxConcurrentAccessChecks).toBe(1);
  });

  it('does not acknowledge traffic until disconnect work is durable', async () => {
    const node = {
      id: 'node_hysteria',
      protocol: 'hysteria2',
      trafficApiBaseUrl: 'mock://hysteria',
      trafficApiSecret: 'secret',
      active: true,
    };
    const store = {
      getNodesForControl: jest.fn().mockResolvedValue([node]),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue(undefined),
      markUserSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markTrafficSyncSuccess: jest.fn().mockResolvedValue(undefined),
      markSyncFailure: jest.fn().mockResolvedValue(undefined),
    };
    const nodeClient = {
      claimTrafficBatch: jest.fn().mockResolvedValue({
        id: 'batch-kick-failure',
        claimedAt: '2026-08-25T00:00:00.000Z',
        traffic: { user_restricted: { tx: 1, rx: 2 } },
      }),
      acknowledgeTrafficBatch: jest.fn().mockResolvedValue({ ok: true }),
    };
    const entitlements = {
      applyTrafficBatch: jest.fn().mockResolvedValue({
        replayed: false,
        impactedUsers: ['user_restricted'],
      }),
      getNodeAccess: jest.fn().mockResolvedValue({ allowed: false }),
    };
    const kickService = {
      withNodeLock: (_id: string, work: () => Promise<unknown>) => work(),
      enqueue: jest
        .fn()
        .mockRejectedValue(new Error('Request failed with status code 502')),
    };
    const service = new UsageSyncService(
      store as never,
      nodeClient as never,
      kickService as never,
      entitlements as never,
      store as never,
    );

    await expect(service.syncAllNodes()).resolves.toEqual([
      expect.objectContaining({
        nodeId: 'node_hysteria',
        error: 'Error: Request failed with status code 502',
      }),
    ]);
    expect(nodeClient.acknowledgeTrafficBatch).not.toHaveBeenCalled();
    expect(store.markTrafficSyncSuccess).not.toHaveBeenCalled();
    expect(store.markSyncFailure).toHaveBeenCalled();
  });

  it('exposes cleanup for the external worker without scheduling it in the API', async () => {
    const cleanupOldData = jest.fn().mockResolvedValue({
      deletedDestinationBatches: 1,
      deletedSnapshots: 2,
      deletedAuthEvents: 3,
    });
    const service = new UsageSyncService(
      { cleanupOldData } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const policy = {
      destinationDays: 7,
      onlineDays: 7,
      authEventDays: 30,
    };
    await expect(service.cleanup(policy)).resolves.toEqual({
      deletedDestinationBatches: 1,
      deletedSnapshots: 2,
      deletedAuthEvents: 3,
    });
    expect(cleanupOldData).toHaveBeenCalledWith(policy);
  });
});
