import { KickService } from './kick-service.service';

describe('KickService', () => {
  it('isolates a node failure and continues kicking the remaining nodes', async () => {
    const store = {
      getNodeIdsForUser: jest
        .fn()
        .mockResolvedValue(['node_unavailable', 'node_available']),
    };
    const nodes = {
      getNodeForControl: jest.fn((nodeId: string) =>
        Promise.resolve({
          id: nodeId,
          protocol: 'vless_reality',
          trafficApiBaseUrl: `mock://${nodeId}`,
          trafficApiSecret: 'secret',
        }),
      ),
    };
    const nodeClient = {
      kickUsers: jest.fn((node: { id: string }) => {
        if (node.id === 'node_unavailable') {
          return Promise.reject(
            new Error('Request failed with status code 502'),
          );
        }
        return Promise.resolve({ kicked: 1 });
      }),
    };
    const service = new KickService(
      store as never,
      nodeClient as never,
      nodes as never,
    );

    await expect(service.kickUserEverywhere('user_1')).resolves.toEqual({
      userId: 'user_1',
      reason: 'manual',
      results: [
        {
          nodeId: 'node_unavailable',
          kicked: false,
          error: 'Request failed with status code 502',
        },
        { nodeId: 'node_available', kicked: true, kickedCount: 1 },
      ],
    });
    expect(nodeClient.kickUsers).toHaveBeenCalledTimes(2);
  });
});
