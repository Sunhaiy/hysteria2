import type { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import {
  NodeTrafficClientService,
  type TrafficNode,
} from './node-traffic-client.service';

describe('NodeTrafficClientService runtime control', () => {
  it.each([401, 429, 500, 502, undefined])(
    'does not clear native counters after a failed durable claim (%s)',
    async (status) => {
      const error = Object.assign(new Error('claim failed'), {
        response: status ? { status } : undefined,
      });
      const http = {
        post: jest.fn().mockReturnValue(throwError(() => error)),
        get: jest.fn().mockReturnValue(of({ data: {} })),
      };
      const client = new NodeTrafficClientService(
        http as unknown as HttpService,
      );
      await expect(
        client.claimTrafficBatch({
          id: 'hy',
          protocol: 'hysteria2',
          hostname: 'node.invalid',
          port: 443,
          trafficApiBaseUrl: 'http://stats.invalid',
          trafficApiSecret: 'fixture',
        }),
      ).rejects.toBe(error);
      expect(http.get).not.toHaveBeenCalled();
    },
  );

  it.each([404, 405])(
    'retains native Hysteria support for unsupported claim (%s)',
    async (status) => {
      const http = {
        post: jest
          .fn()
          .mockReturnValue(throwError(() => ({ response: { status } }))),
        get: jest
          .fn()
          .mockReturnValue(of({ data: { user: { tx: 1, rx: 2 } } })),
      };
      const client = new NodeTrafficClientService(
        http as unknown as HttpService,
      );
      const batch = await client.claimTrafficBatch({
        id: 'hy',
        protocol: 'hysteria2',
        hostname: 'node.invalid',
        port: 443,
        trafficApiBaseUrl: 'http://stats.invalid',
        trafficApiSecret: 'fixture',
      });
      expect(batch.traffic).toEqual({ user: { tx: 1, rx: 2 } });
      expect(batch.id).toMatch(/^legacy-hy-/);
    },
  );

  it('does not accept a legacy VLESS removed-user count as a live disconnect', async () => {
    const post = jest.fn().mockReturnValue(of({ data: { kicked: 1 } }));
    const client = new NodeTrafficClientService({
      post,
    } as unknown as HttpService);
    const node: TrafficNode = {
      id: 'vless',
      hostname: 'test.example',
      port: 443,
      protocol: 'vless_reality',
      trafficApiBaseUrl: 'http://agent.example',
      trafficApiSecret: 'test-secret',
    };
    await expect(client.kickUsers(node, ['user'])).rejects.toThrow(
      '断流未确认',
    );
    post.mockReturnValue(
      of({ data: { kicked: 1, sessionRevocation: 'suxin-session-revoke-v1' } }),
    );
    await expect(client.kickUsers(node, ['user'])).resolves.toMatchObject({
      kicked: 1,
    });
  });

  it('accepts Hysteria native kick without an Xray-specific marker', async () => {
    const client = new NodeTrafficClientService({
      post: jest.fn().mockReturnValue(of({ data: {} })),
    } as unknown as HttpService);
    await expect(
      client.kickUsers(
        {
          id: 'hy',
          hostname: 'test.example',
          port: 443,
          protocol: 'hysteria2',
          trafficApiBaseUrl: 'http://stats.example',
          trafficApiSecret: 'test-secret',
        },
        ['user'],
      ),
    ).resolves.toEqual({});
  });
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
