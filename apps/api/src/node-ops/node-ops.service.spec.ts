import { NodeOpsService } from './node-ops.service';

describe('NodeOpsService server lifecycle', () => {
  it('deletes an empty server', async () => {
    const nodeUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const serverUpdate = jest.fn().mockResolvedValue({ id: 'server_1' });
    const prisma = {
      nodeServer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'server_1',
          retiredAt: null,
          endpoints: [],
        }),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          node: { updateMany: nodeUpdateMany },
          nodeServer: { update: serverUpdate },
        }),
      ),
    };
    const service = new NodeOpsService(prisma as never);

    await service.deleteServer('server_1');

    expect(nodeUpdateMany).toHaveBeenCalledWith({
      where: { serverId: 'server_1', retiredAt: null },
      data: expect.objectContaining({
        active: false,
        lifecycleStatus: 'DISABLED',
        retiredAt: expect.any(Date),
      }),
    });
    expect(serverUpdate).toHaveBeenCalledWith({
      where: { id: 'server_1' },
      data: expect.objectContaining({
        active: false,
        retiredAt: expect.any(Date),
      }),
    });
  });

  it('retires a server together with disabled inactive endpoints', async () => {
    const nodeUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const serverUpdate = jest.fn().mockResolvedValue({ id: 'server_1' });
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
      $transaction: jest.fn(async (callback) =>
        callback({
          node: { updateMany: nodeUpdateMany },
          nodeServer: { update: serverUpdate },
        }),
      ),
    };
    const service = new NodeOpsService(prisma as never);

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
    const service = new NodeOpsService(prisma as never);

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
    const service = new NodeOpsService(prisma as never);

    await expect(service.deleteServer('server_1')).rejects.toThrow(
      '服务器仍有在线连接',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
