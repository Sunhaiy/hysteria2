import type { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import {
  NodeTrafficClientService,
  type TrafficNode,
} from './node-traffic-client.service';

describe('NodeTrafficClientService runtime control', () => {
  it('sends an idempotent stop command to the node agent', async () => {
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          action: 'stop',
          service: 'xray',
          status: 'inactive',
        },
      }),
    );
    const client = new NodeTrafficClientService({
      post,
    } as unknown as HttpService);
    const node: TrafficNode = {
      id: 'node_us_reality',
      protocol: 'vless_reality',
      trafficApiBaseUrl: 'https://agent.example.com',
      trafficApiSecret: 'agent-secret',
      hostname: 'us.example.com',
      port: 443,
    };

    const result = await (
      client as unknown as {
        controlService: (
          target: TrafficNode,
          action: 'start' | 'stop',
          idempotencyKey: string,
        ) => Promise<{ status: string }>;
      }
    ).controlService(node, 'stop', 'command-1');

    expect(post).toHaveBeenCalledWith(
      'https://agent.example.com/service/control',
      { service: 'xray', action: 'stop', idempotencyKey: 'command-1' },
      {
        headers: { Authorization: 'agent-secret' },
        timeout: 10_000,
      },
    );
    expect(result.status).toBe('inactive');
  });
});
