import { NodeProtocol, NodeRuntimeState } from '@prisma/client';
import {
  NodeTrafficGuardService,
  type ServerTrafficGuardEndpoint,
  type ServerTrafficGuardSubject,
} from './node-traffic-guard.service';

const gib = BigInt(1024 ** 3);

function transactionWith<Client>(client: Client) {
  return <Result>(operation: (tx: Client) => Promise<Result>) =>
    operation(client);
}

function createEndpoint(
  overrides: Partial<ServerTrafficGuardEndpoint> = {},
): ServerTrafficGuardEndpoint {
  return {
    id: 'node-1',
    protocol: NodeProtocol.VLESS_REALITY,
    controlApiBaseUrl: null,
    controlApiSecret: null,
    runtimeState: NodeRuntimeState.ACTIVE,
    runtimeStateObservedAt: new Date('2026-08-20T08:00:00.000Z'),
    retiredAt: null,
    ...overrides,
  };
}

function createServer(
  overrides: Partial<ServerTrafficGuardSubject> = {},
): ServerTrafficGuardSubject {
  return {
    id: 'server-1',
    active: true,
    trafficLimitEnabled: true,
    trafficLimitBytes: 100n * gib,
    trafficLimitResetDay: 15,
    retiredAt: null,
    endpoints: [createEndpoint()],
    ...overrides,
  };
}

describe('NodeTrafficGuardService', () => {
  it('projects one Beijing monthly cycle from all endpoint traffic', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { nodeId: 'node-hy2', physicalBytes: 20n * gib },
        { nodeId: 'node-vless', physicalBytes: 40n * gib },
      ]),
      nodeRuntimeCommand: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new NodeTrafficGuardService(prisma as never, {} as never);

    const projections = await service.project(
      [
        createServer({
          endpoints: [
            createEndpoint({
              id: 'node-hy2',
              protocol: NodeProtocol.HYSTERIA2,
              controlApiBaseUrl: 'http://127.0.0.1:59621',
              controlApiSecret: 'secret',
            }),
            createEndpoint({ id: 'node-vless' }),
          ],
        }),
      ],
      new Date('2026-08-28T04:00:00.000Z'),
    );

    expect(projections.get('server-1')).toMatchObject({
      enabled: true,
      configured: true,
      limitBytes: Number(100n * gib),
      usedBytes: Number(60n * gib),
      remainingBytes: Number(40n * gib),
      usagePercent: 60,
      thresholdReached: false,
      cycleStart: '2026-08-14T16:00:00.000Z',
      cycleEnd: '2026-09-14T16:00:00.000Z',
      nextResetAt: '2026-09-14T16:00:00.000Z',
    });
  });

  it('does not scan traffic history for servers without a configured limit', async () => {
    const prisma = {
      $queryRaw: jest.fn(),
      nodeRuntimeCommand: { findMany: jest.fn() },
    };
    const service = new NodeTrafficGuardService(prisma as never, {} as never);

    const projections = await service.project([
      createServer({ trafficLimitEnabled: false, trafficLimitBytes: null }),
    ]);

    expect(projections.get('server-1')).toMatchObject({
      enabled: false,
      limitBytes: null,
      usedBytes: 0,
      status: 'disabled',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.nodeRuntimeCommand.findMany).not.toHaveBeenCalled();
  });

  it('aggregates all endpoint traffic and removes the whole server from access before stopping services', async () => {
    const nodeUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const serverUpdate = jest.fn().mockResolvedValue({ id: 'server-1' });
    const transactionClient = {
      node: { updateMany: nodeUpdateMany },
      nodeServer: { update: serverUpdate },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const server = createServer({
      endpoints: [
        createEndpoint({
          id: 'node-hy2',
          protocol: NodeProtocol.HYSTERIA2,
          controlApiBaseUrl: 'http://127.0.0.1:59621',
          controlApiSecret: 'secret',
        }),
        createEndpoint({ id: 'node-vless' }),
      ],
    });
    const prisma = {
      nodeServer: { findMany: jest.fn().mockResolvedValue([server]) },
      $queryRaw: jest.fn().mockResolvedValue([
        { nodeId: 'node-hy2', physicalBytes: 60n * gib },
        { nodeId: 'node-vless', physicalBytes: 60n * gib },
      ]),
      nodeRuntimeCommand: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const runtime = { requestSystemStop: jest.fn().mockResolvedValue({}) };
    const service = new NodeTrafficGuardService(
      prisma as never,
      runtime as never,
    );

    const result = await service.enforce(new Date('2026-08-28T04:00:00.000Z'));

    expect(result).toMatchObject({ checked: 1, disabled: 1, queued: 2 });
    expect(nodeUpdateMany).toHaveBeenCalledWith({
      where: { serverId: 'server-1', retiredAt: null },
      data: { active: false, lifecycleStatus: 'DISABLED' },
    });
    expect(serverUpdate).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { active: false },
    });
    expect(runtime.requestSystemStop).toHaveBeenCalledTimes(2);
    expect(runtime.requestSystemStop).toHaveBeenCalledWith(
      'node-hy2',
      expect.stringMatching(
        /^server-traffic-limit:server-1:2026-08-14T16:00:00\.000Z:node-hy2:/,
      ),
      expect.objectContaining({
        serverId: 'server-1',
        usedBytes: String(120n * gib),
      }),
    );
  });

  it('disables access at the limit even when one endpoint cannot be stopped', async () => {
    const transactionClient = {
      node: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      nodeServer: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const server = createServer({
      endpoints: [
        createEndpoint({
          protocol: NodeProtocol.HYSTERIA2,
          controlApiBaseUrl: null,
          controlApiSecret: null,
        }),
      ],
    });
    const prisma = {
      nodeServer: { findMany: jest.fn().mockResolvedValue([server]) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ nodeId: 'node-1', physicalBytes: 101n * gib }]),
      nodeRuntimeCommand: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const runtime = { requestSystemStop: jest.fn() };
    const service = new NodeTrafficGuardService(
      prisma as never,
      runtime as never,
    );

    const result = await service.enforce(new Date('2026-08-28T04:00:00.000Z'));

    expect(result).toMatchObject({ checked: 1, disabled: 1, queued: 0 });
    expect(transactionClient.node.updateMany).toHaveBeenCalledTimes(1);
    expect(runtime.requestSystemStop).not.toHaveBeenCalled();
  });

  it('does not disable or stop a server below the threshold', async () => {
    const prisma = {
      nodeServer: {
        findMany: jest.fn().mockResolvedValue([createServer()]),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ nodeId: 'node-1', physicalBytes: 99n * gib }]),
      nodeRuntimeCommand: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    const runtime = { requestSystemStop: jest.fn() };
    const service = new NodeTrafficGuardService(
      prisma as never,
      runtime as never,
    );

    const result = await service.enforce(new Date('2026-08-28T04:00:00.000Z'));

    expect(result).toMatchObject({ checked: 1, disabled: 0, queued: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(runtime.requestSystemStop).not.toHaveBeenCalled();
  });
});
