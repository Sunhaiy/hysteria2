import { Injectable } from '@nestjs/common';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { NodeAdapterRegistry } from '../integrations/node.adapter';

@Injectable()
export class KickService {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly nodeClient: NodeAdapterRegistry,
  ) {}

  async kickUserEverywhere(userId: string, reason = 'manual') {
    const nodeIds = await this.store.getNodeIdsForUser(userId);
    const results = await Promise.all(
      nodeIds.map(async (nodeId) => {
        const node = await this.store.getNodeForControl(nodeId);
        if (!node) {
          return { nodeId, skipped: true };
        }
        await this.nodeClient.kickUsers(node, [userId]);
        return { nodeId, kicked: true };
      }),
    );

    return {
      userId,
      reason,
      results,
    };
  }
}
