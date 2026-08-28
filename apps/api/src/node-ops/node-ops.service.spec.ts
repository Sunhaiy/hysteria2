import { NodeOpsService } from './node-ops.service';

function transactionWith<Client>(client: Client) {
  return <Result>(operation: (tx: Client) => Promise<Result>) =>
    operation(client);
}

describe('NodeOpsService server lifecycle', () => {
  it('deletes an empty server', async () => {
    type NodeUpdateInput = {
      where: { serverId: string; retiredAt: null };
      data: { active: boolean; lifecycleStatus: string; retiredAt: Date };
    };
    type ServerUpdateInput = {
      where: { id: string };
      data: { active: boolean; retiredAt: Date };
    };
    let nodeUpdateInput: NodeUpdateInput | undefined;
    let serverUpdateInput: ServerUpdateInput | undefined;
    const nodeUpdateMany = jest.fn((input: NodeUpdateInput) => {
      nodeUpdateInput = input;
      return Promise.resolve({ count: 0 });
    });
    const serverUpdate = jest.fn((input: ServerUpdateInput) => {
      serverUpdateInput = input;
      return Promise.resolve({ id: 'server_1' });
    });
    const transactionClient = {
      node: { updateMany: nodeUpdateMany },
      nodeServer: { update: serverUpdate },
    };
    const prisma = {
      nodeServer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'server_1',
          retiredAt: null,
          endpoints: [],
        }),
      },
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const service = new NodeOpsService(prisma as never, {} as never);

    await service.deleteServer('server_1');

    expect(nodeUpdateInput?.where).toEqual({
      serverId: 'server_1',
      retiredAt: null,
    });
    expect(nodeUpdateInput?.data).toMatchObject({
      active: false,
      lifecycleStatus: 'DISABLED',
    });
    expect(nodeUpdateInput?.data.retiredAt).toBeInstanceOf(Date);
    expect(serverUpdateInput?.where).toEqual({ id: 'server_1' });
    expect(serverUpdateInput?.data.active).toBe(false);
    expect(serverUpdateInput?.data.retiredAt).toBeInstanceOf(Date);
  });

  it('retires a server together with disabled inactive endpoints', async () => {
    const nodeUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const serverUpdate = jest.fn().mockResolvedValue({ id: 'server_1' });
    const transactionClient = {
      node: { updateMany: nodeUpdateMany },
      nodeServer: { update: serverUpdate },
    };
    const prisma = {
      nodeServer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'server_1',
          retiredAt: null,
          endpoints: [
            {
              id: 'node_1',
              active: false,
              lifecycleStatus: 'DISABLED',
              runtimeState: 'INACTIVE',
              onlinePresence: [],
            },
            {
              id: 'node_2',
              active: false,
              lifecycleStatus: 'DISABLED',
              runtimeState: 'UNKNOWN',
              onlinePresence: [],
            },
          ],
        }),
      },
      $transaction: jest.fn(transactionWith(transactionClient)),
    };
    const service = new NodeOpsService(prisma as never, {} as never);

    await service.deleteServer('server_1');

    expect(nodeUpdateMany).toHaveBeenCalledTimes(1);
    expect(serverUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps a server while an endpoint is still serving users', async () => {
    const prisma = {
      nodeServer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'server_1',
          retiredAt: null,
          endpoints: [
            {
              id: 'node_1',
              active: true,
              lifecycleStatus: 'ACTIVE',
              runtimeState: 'ACTIVE',
              onlinePresence: [{ concurrentClients: 1 }],
            },
          ],
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new NodeOpsService(prisma as never, {} as never);

    await expect(service.deleteServer('server_1')).rejects.toThrow(
      '请先停用服务器下的全部节点',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps a server while a disabled endpoint still has live connections', async () => {
    const prisma = {
      nodeServer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'server_1',
          retiredAt: null,
          endpoints: [
            {
              id: 'node_1',
              active: false,
              lifecycleStatus: 'DISABLED',
              runtimeState: 'INACTIVE',
              onlinePresence: [{ concurrentClients: 1 }],
            },
          ],
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new NodeOpsService(prisma as never, {} as never);

    await expect(service.deleteServer('server_1')).rejects.toThrow(
      '服务器仍有在线连接',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
