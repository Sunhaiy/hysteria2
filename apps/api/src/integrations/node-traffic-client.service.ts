import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createConnection } from 'node:net';

const REQUEST_TIMEOUT_MS = 10_000;

export interface TrafficNode {
  id: string;
  protocol: 'hysteria2' | 'vless_reality';
  trafficApiBaseUrl: string;
  trafficApiSecret: string;
  controlApiBaseUrl?: string | null;
  controlApiSecret?: string | null;
  hostname: string;
  port: number;
}

export type NodeRuntimeState =
  | 'unknown'
  | 'active'
  | 'inactive'
  | 'activating'
  | 'deactivating'
  | 'failed';

export interface NodeServiceStatus {
  service: 'xray' | 'hysteria2';
  status: NodeRuntimeState;
  mainPid: number;
  observedAt: string;
}

export interface NodeHealthProbe {
  agentReachable: boolean;
  coreHealthy: boolean | null;
  publicEndpointReachable: boolean | null;
  latencyMs: number | null;
  error: string | null;
}

export interface ProvisionedUser {
  userId: string;
  id: string;
  email: string;
  flow: string;
}

export interface ClaimedTrafficBatch {
  id: string;
  claimedAt: string;
  traffic: Record<string, { tx: number; rx: number }>;
}

@Injectable()
export class NodeTrafficClientService {
  constructor(private readonly httpService: HttpService) {}

  async claimTrafficBatch(node: TrafficNode): Promise<ClaimedTrafficBatch> {
    if (node.trafficApiBaseUrl.startsWith('mock://')) {
      return {
        id: `mock-${node.id}-${Date.now()}`,
        claimedAt: new Date().toISOString(),
        traffic:
          node.id === 'node_hk_core'
            ? {
                usr_lin: {
                  tx: 128 * 1024 * 1024,
                  rx: 512 * 1024 * 1024,
                },
              }
            : {},
      };
    }

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<ClaimedTrafficBatch>(
          `${node.trafficApiBaseUrl}/traffic/claim`,
          {},
          {
            headers: { Authorization: node.trafficApiSecret },
            timeout: REQUEST_TIMEOUT_MS,
          },
        ),
      );
      return data;
    } catch (error) {
      if (node.protocol === 'vless_reality') throw error;

      // Compatibility for Hysteria Traffic Stats API. This is a single
      // read-and-reset call, which avoids the old read/apply/reset gap.
      const { data } = await firstValueFrom(
        this.httpService.get<Record<string, { tx: number; rx: number }>>(
          `${node.trafficApiBaseUrl}/traffic?clear=1`,
          {
            headers: { Authorization: node.trafficApiSecret },
            timeout: REQUEST_TIMEOUT_MS,
          },
        ),
      );
      return {
        id: `legacy-${node.id}-${Date.now()}`,
        claimedAt: new Date().toISOString(),
        traffic: data,
      };
    }
  }

  async acknowledgeTrafficBatch(node: TrafficNode, batchId: string) {
    if (node.trafficApiBaseUrl.startsWith('mock://')) return { ok: true };
    if (batchId.startsWith(`legacy-${node.id}-`)) return { ok: true };

    const { data } = await firstValueFrom(
      this.httpService.post<{ ok: boolean }>(
        `${node.trafficApiBaseUrl}/traffic/ack`,
        { id: batchId },
        {
          headers: { Authorization: node.trafficApiSecret },
          timeout: REQUEST_TIMEOUT_MS,
        },
      ),
    );
    return data;
  }

  async controlService(
    node: TrafficNode,
    action: 'start' | 'stop',
    idempotencyKey: string,
  ): Promise<NodeServiceStatus> {
    if (node.trafficApiBaseUrl.startsWith('mock://')) {
      return {
        service: this.runtimeService(node),
        status: action === 'start' ? 'active' : 'inactive',
        mainPid: action === 'start' ? 1 : 0,
        observedAt: new Date().toISOString(),
      };
    }
    const target = this.runtimeAgent(node);
    const { data } = await firstValueFrom(
      this.httpService.post<NodeServiceStatus>(
        `${target.baseUrl}/service/control`,
        {
          service: this.runtimeService(node),
          action,
          idempotencyKey,
        },
        {
          headers: { Authorization: target.secret },
          timeout: REQUEST_TIMEOUT_MS,
        },
      ),
    );
    return data;
  }

  async getServiceStatus(node: TrafficNode): Promise<NodeServiceStatus> {
    if (node.trafficApiBaseUrl.startsWith('mock://')) {
      return {
        service: this.runtimeService(node),
        status: 'active',
        mainPid: 1,
        observedAt: new Date().toISOString(),
      };
    }
    const target = this.runtimeAgent(node);
    const service = this.runtimeService(node);
    const { data } = await firstValueFrom(
      this.httpService.get<NodeServiceStatus>(
        `${target.baseUrl}/service/status?service=${service}`,
        {
          headers: { Authorization: target.secret },
          timeout: REQUEST_TIMEOUT_MS,
        },
      ),
    );
    return data;
  }

  async syncUsers(node: TrafficNode, users: ProvisionedUser[]) {
    if (node.protocol !== 'vless_reality') {
      return { added: 0, removed: 0, total: 0 };
    }
    if (node.trafficApiBaseUrl.startsWith('mock://')) {
      return { added: users.length, removed: 0, total: users.length };
    }

    const response = await firstValueFrom(
      this.httpService.put<{ added: number; removed: number; total: number }>(
        `${node.trafficApiBaseUrl}/users`,
        users,
        {
          headers: { Authorization: node.trafficApiSecret },
          timeout: REQUEST_TIMEOUT_MS,
        },
      ),
    );
    return response.data;
  }

  async fetchOnline(node: TrafficNode) {
    if (node.trafficApiBaseUrl.startsWith('mock://')) {
      if (node.id === 'node_hk_core') {
        return { usr_lin: 2 };
      }
      if (node.id === 'node_hk_pro') {
        return { usr_zhou: 1 };
      }
      return {};
    }

    const response = await firstValueFrom(
      this.httpService.get<Record<string, number>>(
        `${node.trafficApiBaseUrl}/online`,
        {
          headers: { Authorization: node.trafficApiSecret },
          timeout: REQUEST_TIMEOUT_MS,
        },
      ),
    );
    return response.data;
  }

  async probeHealth(node: TrafficNode): Promise<NodeHealthProbe> {
    if (node.trafficApiBaseUrl.startsWith('mock://')) {
      return {
        agentReachable: true,
        coreHealthy: true,
        publicEndpointReachable: true,
        latencyMs: 1,
        error: null,
      };
    }
    const startedAt = Date.now();
    try {
      if (node.protocol === 'vless_reality') {
        await firstValueFrom(
          this.httpService.get(`${node.trafficApiBaseUrl}/health`, {
            headers: { Authorization: node.trafficApiSecret },
            timeout: 5_000,
          }),
        );
      } else {
        await firstValueFrom(
          this.httpService.get(`${node.trafficApiBaseUrl}/online`, {
            headers: { Authorization: node.trafficApiSecret },
            timeout: 5_000,
          }),
        );
      }
      const publicEndpointReachable =
        node.protocol === 'vless_reality'
          ? await this.probeTcp(node.hostname, node.port)
          : null;
      return {
        agentReachable: true,
        coreHealthy: true,
        publicEndpointReachable,
        latencyMs: Date.now() - startedAt,
        error:
          publicEndpointReachable === false
            ? 'Client-facing VLESS port is unreachable'
            : null,
      };
    } catch (error) {
      return {
        agentReachable: false,
        coreHealthy: false,
        publicEndpointReachable: null,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private probeTcp(hostname: string, port: number) {
    return new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: hostname, port });
      const finish = (reachable: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(reachable);
      };
      socket.setTimeout(3_000);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  async kickUsers(node: TrafficNode, userIds: string[]) {
    if (node.trafficApiBaseUrl.startsWith('mock://')) {
      return { kicked: userIds.length };
    }

    const response = await firstValueFrom(
      this.httpService.post<{ kicked?: number }>(
        `${node.trafficApiBaseUrl}/kick`,
        userIds,
        {
          headers: { Authorization: node.trafficApiSecret },
          timeout: REQUEST_TIMEOUT_MS,
        },
      ),
    );
    return response.data;
  }

  private runtimeService(node: TrafficNode) {
    return node.protocol === 'vless_reality'
      ? ('xray' as const)
      : ('hysteria2' as const);
  }

  private runtimeAgent(node: TrafficNode) {
    const explicitBaseUrl = node.controlApiBaseUrl?.trim();
    const explicitSecret = node.controlApiSecret?.trim();
    if (explicitBaseUrl && explicitSecret) {
      return {
        baseUrl: explicitBaseUrl.replace(/\/$/, ''),
        secret: explicitSecret,
      };
    }
    if (node.protocol === 'vless_reality') {
      return {
        baseUrl: node.trafficApiBaseUrl.replace(/\/$/, ''),
        secret: node.trafficApiSecret,
      };
    }
    throw new Error('Hysteria2 runtime control agent is not configured');
  }
}
