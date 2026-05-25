import { Injectable } from '@nestjs/common';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { NodeTrafficClientService } from '../integrations/node-traffic-client.service';

@Injectable()
export class KickService {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly nodeClient: NodeTrafficClientService,
  ) {}

  async kickUserEverywhere(userId: string, reason = 'manual') {
    const nodeIds = await this.store.getNodeIdsForUser(userId);
    const results = await Promise.all(
      nodeIds.map(async (nodeId) => {
        const node = await this.store.getNodeById(nodeId);
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
