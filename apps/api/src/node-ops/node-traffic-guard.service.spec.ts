import { NodeProtocol, NodeRuntimeState } from '@prisma/client';
import {
  NodeTrafficGuardService,
  type NodeTrafficGuardSubject,
} from './node-traffic-guard.service';

const gib = BigInt(1024 ** 3);

function createNode(
  overrides: Partial<NodeTrafficGuardSubject> = {},
): NodeTrafficGuardSubject {
  return {
    id: 'node-1',
    protocol: NodeProtocol.VLESS_REALITY,
    controlApiBaseUrl: null,
    controlApiSecret: null,
    runtimeState: NodeRuntimeState.ACTIVE,
    runtimeStateObservedAt: new Date('2026-08-20T08:00:00.000Z'),
    trafficLimitEnabled: true,
    trafficLimitBytes: 100n * gib,
    trafficLimitResetDay: 15,
    retiredAt: null,
    ...overrides,
  };
}

describe('NodeTrafficGuardService', () => {
  it('projects a Beijing monthly cycle from raw bidirectional traffic', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ nodeId: 'node-1', physicalBytes: 60n * gib }]),
      nodeRuntimeCommand: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new NodeTrafficGuardService(prisma as never, {} as never);

    const projections = await service.project(
      [createNode()],
      new Date('2026-08-28T04:00:00.000Z'),
    );

    expect(projections.get('node-1')).toMatchObject({
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

  it('does not scan traffic history for nodes without a configured limit', async () => {
    const prisma = {
      $queryRaw: jest.fn(),
      nodeRuntimeCommand: { findMany: jest.fn() },
    };
    const service = new NodeTrafficGuardService(prisma as never, {} as never);

    const projections = await service.project([
      createNode({ trafficLimitEnabled: false, trafficLimitBytes: null }),
    ]);

    expect(projections.get('node-1')).toMatchObject({
      enabled: false,
      limitBytes: null,
      usedBytes: 0,
      status: 'disabled',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.nodeRuntimeCommand.findMany).not.toHaveBeenCalled();
  });

  it('queues one automatic stop after the threshold is reached', async () => {
    const prisma = {
      node: { findMany: jest.fn().mockResolvedValue([createNode()]) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ nodeId: 'node-1', physicalBytes: 101n * gib }]),
      nodeRuntimeCommand: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              nodeId: 'node-1',
              status: 'QUEUED',
              idempotencyKey:
                'node-traffic-limit:node-1:2026-08-14T16:00:00.000Z:1787212800000',
            },
          ]),
      },
    };
    const runtime = { requestSystemStop: jest.fn().mockResolvedValue({}) };
    const service = new NodeTrafficGuardService(
      prisma as never,
      runtime as never,
    );
    const now = new Date('2026-08-28T04:00:00.000Z');

    await service.enforce(now);
    await service.enforce(now);

    expect(runtime.requestSystemStop).toHaveBeenCalledTimes(1);
    expect(runtime.requestSystemStop).toHaveBeenCalledWith(
      'node-1',
      expect.stringMatching(
        /^node-traffic-limit:node-1:2026-08-14T16:00:00\.000Z:/,
      ),
      expect.objectContaining({
        cycleStart: '2026-08-14T16:00:00.000Z',
        limitBytes: String(100n * gib),
        usedBytes: String(101n * gib),
      }),
    );
  });

  it('retries a failed automatic stop in the next minute window', async () => {
    const prisma = {
      node: { findMany: jest.fn().mockResolvedValue([createNode()]) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ nodeId: 'node-1', physicalBytes: 101n * gib }]),
      nodeRuntimeCommand: {
        findMany: jest.fn().mockResolvedValue([
          {
            nodeId: 'node-1',
            status: 'FAILED',
            idempotencyKey:
              'node-traffic-limit:node-1:2026-08-14T16:00:00.000Z:1787212800000:29798160',
          },
        ]),
      },
    };
    const runtime = { requestSystemStop: jest.fn().mockResolvedValue({}) };
    const service = new NodeTrafficGuardService(
      prisma as never,
      runtime as never,
    );

    await service.enforce(new Date('2026-08-28T04:01:00.000Z'));

    expect(runtime.requestSystemStop).toHaveBeenCalledTimes(1);
    expect(runtime.requestSystemStop).toHaveBeenCalledWith(
      'node-1',
      expect.stringMatching(/:29798161$/),
      expect.any(Object),
    );
  });

  it.each([
    ['below the threshold', createNode(), 99n * gib],
    [
      'the service is already stopped',
      createNode({ runtimeState: NodeRuntimeState.INACTIVE }),
      101n * gib,
    ],
    [
      'Hysteria2 runtime control is not configured',
      createNode({
        protocol: NodeProtocol.HYSTERIA2,
        controlApiBaseUrl: null,
        controlApiSecret: null,
      }),
      101n * gib,
    ],
  ])('does not queue a stop when %s', async (_reason, node, usedBytes) => {
    const prisma = {
      node: { findMany: jest.fn().mockResolvedValue([node]) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ nodeId: 'node-1', physicalBytes: usedBytes }]),
      nodeRuntimeCommand: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const runtime = { requestSystemStop: jest.fn() };
    const service = new NodeTrafficGuardService(
      prisma as never,
      runtime as never,
    );

    await service.enforce(new Date('2026-08-28T04:00:00.000Z'));

    expect(runtime.requestSystemStop).not.toHaveBeenCalled();
  });
});
