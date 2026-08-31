import { NodeOpsService } from './node-ops.service';

type NodeUpdateInput = {
  where: { serverId: string; retiredAt: null };
  data: { active: boolean; lifecycleStatus: string; retiredAt?: Date };
};

type ServerUpdateInput = {
  where: { id: string };
  data: { active: boolean; retiredAt?: Date };
};

function transactionWith<Client>(client: Client) {
  return <Result>(operation: (tx: Client) => Promise<Result>) =>
    operation(client);
}

function createHarness(
  endpoints: Array<{ id: string; runtimeState: string }> = [],
) {
  const nodeUpdateMany = jest
    .fn<Promise<{ count: number }>, [NodeUpdateInput]>()
    .mockResolvedValue({ count: endpoints.length });
  const serverUpdate = jest
    .fn<Promise<{ id: string }>, [ServerUpdateInput]>()
    .mockResolvedValue({ id: 'server_1' });
  const transactionClient = {
    node: { updateMany: nodeUpdateMany },
    nodeServer: { update: serverUpdate },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const server = {
    id: 'server_1',
    retiredAt: null,
    endpoints,
  };
  const prisma = {
    nodeServer: {
      findUnique: jest.fn().mockResolvedValue(server),
      findFirst: jest.fn().mockResolvedValue(server),
    },
    $transaction: jest.fn(transactionWith(transactionClient)),
  };
  const runtime = {
    requestSystemStop: jest.fn().mockResolvedValue({ status: 'queued' }),
  };
  const service = new NodeOpsService(
    prisma as never,
    {} as never,
    runtime as never,
  );
  return {
    service,
    prisma,
    runtime,
    nodeUpdateMany,
    serverUpdate,
  };
}

describe('NodeOpsService server lifecycle', () => {
  it('retires an empty server', async () => {
    const harness = createHarness();

    await harness.service.deleteServer('server_1');

    expect(harness.runtime.requestSystemStop).not.toHaveBeenCalled();
    const nodeUpdate = harness.nodeUpdateMany.mock.calls[0][0];
    const serverUpdate = harness.serverUpdate.mock.calls[0][0];
    expect(nodeUpdate).toMatchObject({
      where: { serverId: 'server_1', retiredAt: null },
      data: {
        active: false,
        lifecycleStatus: 'DISABLED',
      },
    });
    expect(nodeUpdate.data.retiredAt).toBeInstanceOf(Date);
    expect(serverUpdate).toMatchObject({
      where: { id: 'server_1' },
      data: { active: false },
    });
    expect(serverUpdate.data.retiredAt).toBeInstanceOf(Date);
  });

  it('retires a serving server and queues every running endpoint stop', async () => {
    const harness = createHarness([
      { id: 'node_hy2', runtimeState: 'ACTIVE' },
      { id: 'node_vless', runtimeState: 'UNKNOWN' },
      { id: 'node_stopped', runtimeState: 'INACTIVE' },
    ]);

    await harness.service.deleteServer('server_1');

    expect(harness.runtime.requestSystemStop).toHaveBeenCalledTimes(2);
    expect(harness.runtime.requestSystemStop).toHaveBeenCalledWith(
      'node_hy2',
      'server-delete:server_1:node_hy2',
      { serverId: 'server_1' },
    );
    expect(harness.runtime.requestSystemStop).toHaveBeenCalledWith(
      'node_vless',
      'server-delete:server_1:node_vless',
      { serverId: 'server_1' },
    );
    expect(harness.nodeUpdateMany).toHaveBeenCalledTimes(1);
    expect(harness.serverUpdate).toHaveBeenCalledTimes(1);
  });

  it('still retires the server when an endpoint stop cannot be queued', async () => {
    const harness = createHarness([{ id: 'node_hy2', runtimeState: 'ACTIVE' }]);
    harness.runtime.requestSystemStop.mockRejectedValue(
      new Error('agent unavailable'),
    );

    await harness.service.deleteServer('server_1');

    expect(harness.nodeUpdateMany).toHaveBeenCalledTimes(1);
    expect(harness.serverUpdate).toHaveBeenCalledTimes(1);
  });

  it('disables an unreachable server before attempting remote stops', async () => {
    const harness = createHarness([
      { id: 'node_hy2', runtimeState: 'ACTIVE' },
      { id: 'node_vless', runtimeState: 'ACTIVE' },
    ]);
    harness.runtime.requestSystemStop.mockRejectedValue(
      new Error('agent unavailable'),
    );

    await expect(
      harness.service.stopServer('server_1', 'admin_1'),
    ).resolves.toMatchObject({
      serverId: 'server_1',
      disabledEndpoints: 2,
      queuedStops: 0,
    });

    expect(harness.nodeUpdateMany).toHaveBeenCalledWith({
      where: { serverId: 'server_1', retiredAt: null },
      data: { active: false, lifecycleStatus: 'DISABLED' },
    });
    expect(harness.serverUpdate).toHaveBeenCalledWith({
      where: { id: 'server_1' },
      data: { active: false },
    });
  });
});
