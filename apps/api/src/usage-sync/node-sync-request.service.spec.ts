import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { CacheService } from '../cache/cache.service';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { NodeControlService } from '../domain/node-control.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import {
  HysteriaNodeAdapter,
  NodeAdapterRegistry,
  TestNodeAdapter,
  XrayHttpNodeAdapter,
} from '../integrations/node.adapter';
import { NodeTrafficClientService } from '../integrations/node-traffic-client.service';
import { QuotaEnforcementService } from '../kick-service/quota-enforcement.service';
import { NodeSyncRequestService } from './node-sync-request.service';
import { UsageSyncService } from './usage-sync.service';

describe('Worker-owned manual node synchronization', () => {
  const originalEnv = {
    NODE_SYNC_ENABLED: process.env.NODE_SYNC_ENABLED,
    HYSTERIA_SYNC_ENABLED: process.env.HYSTERIA_SYNC_ENABLED,
    NODE_ENV: process.env.NODE_ENV,
    REDIS_URL: process.env.REDIS_URL,
  };

  beforeEach(() => {
    process.env.NODE_SYNC_ENABLED = 'true';
    delete process.env.HYSTERIA_SYNC_ENABLED;
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const fixture = () => {
    let active = true;
    let missing = false;
    let failAgent = false;
    const agentRequests: string[] = [];
    const row = (id: string) => ({
      id,
      active,
      protocol: 'HYSTERIA2',
      lifecycleStatus: 'ACTIVE',
      label: id,
      hostname: 'fixture.invalid',
      port: 443,
      trafficApiBaseUrl: 'http://fixture.invalid',
      trafficApiSecret: 'fixture-secret',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSyncAt: new Date(),
      lastSyncError: null,
      server: null,
    });
    const db = {
      $transaction: <T>(
        operation: (client: unknown) => Promise<T>,
      ): Promise<T> => operation(db),
      $executeRaw: () => Promise.resolve(1),
      node: {
        findFirst: ({ where }: { where: { id: string } }) =>
          Promise.resolve(missing ? null : row(where.id)),
        findUniqueOrThrow: ({ where }: { where: { id: string } }) =>
          Promise.resolve(row(where.id)),
      },
      usageImportBatch: {
        findMany: () => Promise.resolve([]),
        findUnique: () => Promise.resolve(null),
        create: () => Promise.resolve({ id: 'receipt' }),
        update: () => Promise.resolve({}),
        updateMany: () => Promise.resolve({ count: 1 }),
      },
    };
    const client = new NodeTrafficClientService({
      post: (url: string) => {
        agentRequests.push(url);
        if (failAgent) return throwError(() => new Error('agent unavailable'));
        return of({
          data: url.endsWith('/claim')
            ? {
                id: 'fixture-batch',
                claimedAt: new Date().toISOString(),
                traffic: {},
              }
            : { ok: true },
        });
      },
    } as never);
    const adapters = new NodeAdapterRegistry(
      new TestNodeAdapter(client),
      new HysteriaNodeAdapter(client),
      new XrayHttpNodeAdapter(client),
    );
    const nodes = new NodeControlService(
      db as never,
      { decrypt: (value: string) => value } as never,
    );
    const entitlements = new EntitlementService(db as never);
    const enforcement = new QuotaEnforcementService(
      db as never,
      nodes,
      entitlements,
      adapters,
    );
    const sync = new UsageSyncService(
      new ControlPlaneStoreService(db as never, {} as never),
      adapters,
      enforcement,
      entitlements,
      nodes,
    );
    const cache = new CacheService();
    return {
      api: new NodeSyncRequestService(cache, nodes, sync),
      worker: new NodeSyncRequestService(cache, nodes, sync),
      cache,
      agentRequests,
      disable: () => {
        active = false;
      },
      missing: () => {
        missing = true;
      },
      failAgent: () => {
        failAgent = true;
      },
    };
  };

  it('queues without node traffic, then the worker performs the real sync flow once', async () => {
    const f = fixture();
    await expect(f.api.request('node')).resolves.toEqual({
      accepted: true,
      nodeId: 'node',
    });
    await f.api.request('node');
    expect(f.agentRequests).toEqual([]);

    await expect(f.worker.processPending()).resolves.toEqual([
      { nodeId: 'node', status: 'succeeded' },
    ]);
    expect(f.agentRequests).toEqual([
      'http://fixture.invalid/traffic/claim',
      'http://fixture.invalid/traffic/ack',
    ]);
    await expect(f.worker.processPending()).resolves.toEqual([]);
  });

  it('rejects disabled sync and unavailable nodes without contacting an agent', async () => {
    const f = fixture();
    process.env.NODE_SYNC_ENABLED = 'false';
    await expect(f.api.request('node')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    process.env.NODE_SYNC_ENABLED = 'true';
    f.disable();
    await expect(f.api.request('node')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    f.missing();
    await expect(f.api.request('node')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(f.agentRequests).toEqual([]);
  });

  it('never acknowledges a production request stored only in process memory', async () => {
    const f = fixture();
    process.env.NODE_ENV = 'production';
    await expect(f.api.request('node')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // Simulate a successful health probe followed by Redis losing readiness.
    jest
      .spyOn(f.cache, 'health')
      .mockResolvedValue({ ok: true, adapter: 'redis' });
    await expect(f.api.request('node')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    process.env.NODE_ENV = 'test';
    await expect(f.worker.processPending()).resolves.toEqual([]);
    expect(f.agentRequests).toEqual([]);
  });

  it('processes a bounded batch and keeps remaining nodes queued', async () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) await f.api.request(`node-${i}`);
    expect(await f.worker.processPending()).toHaveLength(4);
    expect(await f.worker.processPending()).toHaveLength(2);
    expect(await f.worker.processPending()).toHaveLength(0);
  });

  it('expires old requests and leaves failed work to the routine sync schedule', async () => {
    const f = fixture();
    await f.api.request('expired');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 121000);
    await expect(f.worker.processPending()).resolves.toEqual([
      { nodeId: 'expired', status: 'expired' },
    ]);
    expect(f.agentRequests).toEqual([]);
    clock.mockRestore();
    await f.api.request('failed');
    f.failAgent();
    await expect(f.worker.processPending()).resolves.toEqual([
      { nodeId: 'failed', status: 'failed' },
    ]);
    await expect(f.worker.processPending()).resolves.toEqual([]);
  });
});
