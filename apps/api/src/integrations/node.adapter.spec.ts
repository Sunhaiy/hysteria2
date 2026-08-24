import { Test } from '@nestjs/testing';
import {
  HysteriaNodeAdapter,
  NodeAdapterRegistry,
  TestNodeAdapter,
  XrayHttpNodeAdapter,
} from './node.adapter';
import { NodeTrafficClientService } from './node-traffic-client.service';

describe('NodeAdapterRegistry', () => {
  it('injects the traffic client into inherited HTTP adapters', async () => {
    const client = {
      claimTrafficBatch: jest.fn().mockResolvedValue({
        id: 'batch-1',
        claimedAt: new Date().toISOString(),
        traffic: {},
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        NodeAdapterRegistry,
        HysteriaNodeAdapter,
        XrayHttpNodeAdapter,
        TestNodeAdapter,
        { provide: NodeTrafficClientService, useValue: client },
      ],
    }).compile();

    const registry = module.get(NodeAdapterRegistry);
    await registry.claimTrafficBatch({
      id: 'node-hy2',
      protocol: 'hysteria2',
      trafficApiBaseUrl: 'https://node.example.test',
      trafficApiSecret: 'secret',
    });

    expect(client.claimTrafficBatch).toHaveBeenCalledTimes(1);
  });
});
