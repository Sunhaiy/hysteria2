import { NodeOpsService } from './node-ops.service';

describe('NodeOpsService server lifecycle', () => {
  it('deletes an empty server', async () => {
    const prisma = {
      nodeServer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'server_1',
          _count: { endpoints: 0 },
        }),
        delete: jest.fn().mockResolvedValue({ id: 'server_1' }),
      },
    };
    const service = new NodeOpsService(prisma as never);

    await service.deleteServer('server_1');

    expect(prisma.nodeServer.delete).toHaveBeenCalledWith({
      where: { id: 'server_1' },
    });
  });

  it('keeps a server while it still owns nodes', async () => {
    const prisma = {
      nodeServer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'server_1',
          _count: { endpoints: 2 },
        }),
        delete: jest.fn(),
      },
    };
    const service = new NodeOpsService(prisma as never);

    await expect(service.deleteServer('server_1')).rejects.toThrow(
      'Move or delete every node on this server before deleting it',
    );
    expect(prisma.nodeServer.delete).not.toHaveBeenCalled();
  });
});
