import { Injectable, Logger } from '@nestjs/common';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { NodeControlService } from '../domain/node-control.service';
import { NodeAdapterRegistry } from '../integrations/node.adapter';

@Injectable()
export class KickService {
  private readonly logger = new Logger(KickService.name);

  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly nodeClient: NodeAdapterRegistry,
    private readonly nodes: NodeControlService,
  ) {}

  async kickUserEverywhere(userId: string, reason = 'manual') {
    const nodeIds = await this.store.getNodeIdsForUser(userId);
    const results = await Promise.all(
      nodeIds.map(async (nodeId) => {
        try {
          const node = await this.nodes.getNodeForControl(nodeId);
          if (!node) {
            return { nodeId, skipped: true };
          }
          const result = await this.nodeClient.kickUsers(node, [userId]);
          return { nodeId, kicked: true, kickedCount: result.kicked ?? null };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to kick user ${userId} from node ${nodeId}: ${message}`,
          );
          return { nodeId, kicked: false, error: message };
        }
      }),
    );

    return {
      userId,
      reason,
      results,
    };
  }
}
