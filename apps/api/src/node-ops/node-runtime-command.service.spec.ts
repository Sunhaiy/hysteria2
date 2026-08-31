import { NodeRuntimeCommandService } from './node-runtime-command.service';

function transactionWith<Client>(client: Client) {
  return <Result>(operation: (tx: Client) => Promise<Result>) =>
    operation(client);
}

describe('NodeRuntimeCommandService', () => {
  const queued = {
    id: 'command-1',
    nodeId: 'node-1',
    requestedById: 'admin-1',
    action: 'STOP',
    status: 'QUEUED',
    idempotencyKey: 'request-1',
    attemptCount: 0,
    resultState: null,
    error: null,
    requestedAt: new Date('2026-08-25T03:00:00.000Z'),
    startedAt: null,
    completedAt: null,
  };

  function createService(overrides: {
    prisma?: Record<string, unknown>;
    adapters?: Record<string, unknown>;
    nodes?: Record<string, unknown>;
  }) {
    return new NodeRuntimeCommandService(
      (overrides.prisma ?? {}) as never,
      (overrides.adapters ?? {}) as never,
      (overrides.nodes ?? {}) as never,
    );
  }

  it('queues a runtime command without calling the node agent in the API path', async () => {
    const transactionClient = {
      node: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'node-1',
          protocol: 'VLESS_REALITY',
          controlApiBaseUrl: null,
          controlApiSecret: null,
        }),
      },
      nodeRuntimeCommand: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(queued),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const adapters = { controlService: jest.fn() };
    const service = createService({ prisma, adapters });

    await expect(
      service.request(
        'node-1',
        { action: 'stop', idempotencyKey: 'request-1' },
        'admin-1',
      ),
    ).resolves.toMatchObject({
      id: 'command-1',
      action: 'stop',
      status: 'queued',
    });
    expect(adapters.controlService).not.toHaveBeenCalled();
  });

  it('returns the original command for a repeated idempotency key', async () => {
    const transactionClient = {
      nodeRuntimeCommand: {
        findUnique: jest.fn().mockResolvedValue(queued),
        create: jest.fn(),
      },
      node: { findUnique: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const service = createService({ prisma });

    await expect(
      service.request(
        'node-1',
        { action: 'stop', idempotencyKey: 'request-1' },
        'admin-1',
      ),
    ).resolves.toMatchObject({ id: 'command-1', status: 'queued' });
    expect(transactionClient.node.findUnique).not.toHaveBeenCalled();
    expect(transactionClient.nodeRuntimeCommand.create).not.toHaveBeenCalled();
    expect(transactionClient.auditLog.create).not.toHaveBeenCalled();
  });

  it('queues automatic traffic-limit stops as a system audit event', async () => {
    type CommandInput = {
      data: { requestedById: string | null; action: string };
    };
    type AuditInput = {
      data: {
        actorId: string | null;
        action: string;
        metadata: Record<string, string>;
      };
    };
    let commandInput: CommandInput | undefined;
    let auditInput: AuditInput | undefined;
    const transactionClient = {
      node: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'node-1',
          protocol: 'VLESS_REALITY',
          controlApiBaseUrl: null,
          controlApiSecret: null,
        }),
      },
      nodeRuntimeCommand: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((input: CommandInput) => {
          commandInput = input;
          return Promise.resolve({
            ...queued,
            requestedById: null,
            idempotencyKey: 'node-traffic-limit:node-1:cycle:observed',
          });
        }),
      },
      auditLog: {
        create: jest.fn((input: AuditInput) => {
          auditInput = input;
          return Promise.resolve({});
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const service = createService({ prisma });

    await service.requestSystemStop(
      'node-1',
      'node-traffic-limit:node-1:cycle:observed',
      { limitBytes: '100', usedBytes: '101' },
    );

    expect(commandInput?.data).toMatchObject({
      requestedById: null,
      action: 'STOP',
    });
    expect(auditInput?.data.actorId).toBeNull();
    expect(auditInput?.data.action).toBe('node.runtime.stop.auto_requested');
    expect(auditInput?.data.metadata).toMatchObject({
      limitBytes: '100',
      usedBytes: '101',
    });
  });

  it('executes a claimed stop command and records the observed inactive state', async () => {
    const transactionClient = {
      nodeRuntimeCommand: {
        findFirst: jest.fn().mockResolvedValue(queued),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      node: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...transactionClient,
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const adapters = {
      controlService: jest.fn().mockResolvedValue({
        service: 'xray',
        status: 'inactive',
        observedAt: '2026-08-25T03:00:03.000Z',
      }),
    };
    const nodes = {
      getNodeForRuntimeCommand: jest.fn().mockResolvedValue({
        id: 'node-1',
        protocol: 'vless_reality',
        trafficApiBaseUrl: 'https://agent.example.com',
        trafficApiSecret: 'secret',
      }),
    };
    const service = createService({ prisma, adapters, nodes });

    await expect(service.processNext()).resolves.toMatchObject({
      id: 'command-1',
      status: 'succeeded',
      resultState: 'inactive',
    });
    expect(adapters.controlService).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node-1' }),
      'stop',
      'request-1',
    );
    expect(transactionClient.node.update).toHaveBeenCalledWith({
      where: { id: 'node-1' },
      data: {
        runtimeState: 'INACTIVE',
        runtimeStateObservedAt: new Date('2026-08-25T03:00:03.000Z'),
        runtimeError: null,
      },
    });
  });

  it('turns a pending command into a stop after the node is retired', async () => {
    const retiredStart = { ...queued, action: 'START' };
    const transactionClient = {
      nodeRuntimeCommand: {
        findFirst: jest.fn().mockResolvedValue(retiredStart),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      node: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...transactionClient,
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const adapters = {
      controlService: jest.fn().mockResolvedValue({
        service: 'xray',
        status: 'inactive',
        observedAt: '2026-08-25T03:00:03.000Z',
      }),
    };
    const nodes = {
      getNodeForRuntimeCommand: jest.fn().mockResolvedValue({
        id: 'node-1',
        protocol: 'vless_reality',
        trafficApiBaseUrl: 'https://agent.example.com',
        trafficApiSecret: 'secret',
        retiredAt: '2026-08-25T03:00:01.000Z',
      }),
    };
    const service = createService({ prisma, adapters, nodes });

    await expect(service.processNext()).resolves.toMatchObject({
      id: 'command-1',
      status: 'succeeded',
      resultState: 'inactive',
    });
    expect(adapters.controlService).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node-1' }),
      'stop',
      'retirement:request-1',
    );
  });

  it('marks the command failed without reporting a successful runtime state', async () => {
    const transactionClient = {
      nodeRuntimeCommand: {
        findFirst: jest.fn().mockResolvedValue({ ...queued, action: 'START' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      node: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...transactionClient,
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const adapters = {
      controlService: jest
        .fn()
        .mockRejectedValue(new Error('agent unavailable')),
    };
    const nodes = {
      getNodeForRuntimeCommand: jest.fn().mockResolvedValue({
        id: 'node-1',
        protocol: 'vless_reality',
        trafficApiBaseUrl: 'https://agent.example.com',
        trafficApiSecret: 'secret',
      }),
    };
    const service = createService({ prisma, adapters, nodes });

    await expect(service.processNext()).resolves.toMatchObject({
      id: 'command-1',
      status: 'failed',
      error: 'agent unavailable',
    });
    expect(transactionClient.node.update).toHaveBeenCalledWith({
      where: { id: 'node-1' },
      data: { runtimeError: 'agent unavailable' },
    });
    expect(transactionClient.node.update).toHaveBeenCalledTimes(1);
  });
});
