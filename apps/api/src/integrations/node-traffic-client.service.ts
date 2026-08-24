import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const REQUEST_TIMEOUT_MS = 10_000;

export interface TrafficNode {
  id: string;
  protocol: 'hysteria2' | 'vless_reality';
  trafficApiBaseUrl: string;
  trafficApiSecret: string;
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
}
