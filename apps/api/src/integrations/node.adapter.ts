import { Injectable } from '@nestjs/common';
import {
  type ClaimedTrafficBatch,
  NodeTrafficClientService,
  type ProvisionedUser,
  type TrafficNode,
} from './node-traffic-client.service';

export interface NodeAdapter {
  readonly name: string;
  supports(node: TrafficNode): boolean;
  claimTrafficBatch(node: TrafficNode): Promise<ClaimedTrafficBatch>;
  acknowledgeTrafficBatch(
    node: TrafficNode,
    batchId: string,
  ): Promise<{ ok: boolean }>;
  syncUsers(
    node: TrafficNode,
    users: ProvisionedUser[],
  ): Promise<{ added: number; removed: number; total: number }>;
  fetchOnline(node: TrafficNode): Promise<Record<string, number>>;
  kickUsers(node: TrafficNode, userIds: string[]): Promise<{ kicked?: number }>;
}

abstract class HttpNodeAdapter implements NodeAdapter {
  abstract readonly name: string;

  constructor(protected readonly client: NodeTrafficClientService) {}

  abstract supports(node: TrafficNode): boolean;

  claimTrafficBatch(node: TrafficNode) {
    return this.client.claimTrafficBatch(node);
  }

  acknowledgeTrafficBatch(node: TrafficNode, batchId: string) {
    return this.client.acknowledgeTrafficBatch(node, batchId);
  }

  syncUsers(node: TrafficNode, users: ProvisionedUser[]) {
    return this.client.syncUsers(node, users);
  }

  fetchOnline(node: TrafficNode) {
    return this.client.fetchOnline(node);
  }

  kickUsers(node: TrafficNode, userIds: string[]) {
    return this.client.kickUsers(node, userIds);
  }
}

@Injectable()
export class HysteriaNodeAdapter extends HttpNodeAdapter {
  readonly name = 'hysteria-http';

  constructor(client: NodeTrafficClientService) {
    super(client);
  }

  supports(node: TrafficNode) {
    return (
      node.protocol === 'hysteria2' &&
      !node.trafficApiBaseUrl.startsWith('mock://')
    );
  }
}

@Injectable()
export class XrayHttpNodeAdapter extends HttpNodeAdapter {
  readonly name = 'xray-http';

  constructor(client: NodeTrafficClientService) {
    super(client);
  }

  supports(node: TrafficNode) {
    return (
      node.protocol === 'vless_reality' &&
      !node.trafficApiBaseUrl.startsWith('mock://')
    );
  }
}

@Injectable()
export class TestNodeAdapter extends HttpNodeAdapter {
  readonly name = 'test';

  constructor(client: NodeTrafficClientService) {
    super(client);
  }

  supports(node: TrafficNode) {
    return node.trafficApiBaseUrl.startsWith('mock://');
  }
}

@Injectable()
export class NodeAdapterRegistry {
  private readonly adapters: NodeAdapter[];

  constructor(
    test: TestNodeAdapter,
    hysteria: HysteriaNodeAdapter,
    xray: XrayHttpNodeAdapter,
  ) {
    this.adapters = [test, hysteria, xray];
  }

  adapterFor(node: TrafficNode) {
    const adapter = this.adapters.find((candidate) => candidate.supports(node));
    if (!adapter) throw new Error(`No NodeAdapter for ${node.protocol}`);
    return adapter;
  }

  claimTrafficBatch(node: TrafficNode) {
    return this.adapterFor(node).claimTrafficBatch(node);
  }

  acknowledgeTrafficBatch(node: TrafficNode, batchId: string) {
    return this.adapterFor(node).acknowledgeTrafficBatch(node, batchId);
  }

  syncUsers(node: TrafficNode, users: ProvisionedUser[]) {
    return this.adapterFor(node).syncUsers(node, users);
  }

  fetchOnline(node: TrafficNode) {
    return this.adapterFor(node).fetchOnline(node);
  }

  kickUsers(node: TrafficNode, userIds: string[]) {
    return this.adapterFor(node).kickUsers(node, userIds);
  }
}
