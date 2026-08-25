import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { NodeControlService } from '../domain/node-control.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { NodeAdapterRegistry } from '../integrations/node.adapter';
import { KickService } from '../kick-service/kick-service.service';

@Injectable()
export class UsageSyncService {
  private readonly logger = new Logger(UsageSyncService.name);
  private readonly activeNodeSyncs = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly nodeClient: NodeAdapterRegistry,
    private readonly kickService: KickService,
    private readonly entitlements: EntitlementService,
    private readonly nodes: NodeControlService,
  ) {}

  async cleanup(retentionDays: number) {
    return this.store.cleanupOldData(retentionDays);
  }

  async syncAllNodes() {
    const nodes = (await this.nodes.getNodesForControl()).filter(
      (node) => node.active,
    );

    const results = [];
    for (const node of nodes) {
      try {
        results.push(
          await this.withNodeLock(node.id, () => this.syncNodeRecord(node)),
        );
      } catch (error) {
        this.logger.warn(`Failed to sync node ${node.id}: ${String(error)}`);
        results.push({ nodeId: node.id, error: String(error) });
      }
    }

    return results;
  }

  async syncNode(nodeId: string) {
    const node = await this.nodes.getNodeForControl(nodeId);
    if (!node) throw new NotFoundException(`Unknown node: ${nodeId}`);
    if (!node.active) {
      throw new BadRequestException(`Node is disabled: ${nodeId}`);
    }
    try {
      return await this.withNodeLock(node.id, () => this.syncNodeRecord(node));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadGatewayException(`Node sync failed: ${message}`);
    }
  }

  private async syncNodeRecord(
    node: Awaited<ReturnType<NodeControlService['getNodeForControl']>> & object,
  ) {
    try {
      let provisionedUsers = 0;
      if (node.protocol === 'vless_reality') {
        const users = await this.entitlements.getNodeProvisioningUsers(node.id);
        await this.nodeClient.syncUsers(
          node,
          users.map((user) => ({
            ...user,
            email: user.userId,
            flow: node.vlessFlow ?? 'xtls-rprx-vision',
          })),
        );
        provisionedUsers = users.length;
      }
      await this.nodes.markUserSyncSuccess(node.id);

      const batch = await this.nodeClient.claimTrafficBatch(node);
      const applied = await this.entitlements.applyTrafficBatch(node.id, batch);
      await this.nodeClient.acknowledgeTrafficBatch(node, batch.id);
      await this.store.acknowledgeTrafficBatch(node.id, batch.id);
      await this.nodes.markTrafficSyncSuccess(node.id);
      const impactedUsers = applied.impactedUsers;

      const restrictionChecks = [];
      for (const userId of impactedUsers) {
        restrictionChecks.push({
          userId,
          restricted: !(await this.entitlements.getNodeAccess(userId, node.id))
            .allowed,
        });
      }

      await Promise.all(
        restrictionChecks
          .filter((item) => item.restricted)
          .map(async (item) => {
            try {
              await this.kickService.kickUserEverywhere(
                item.userId,
                'usage-sync',
              );
            } catch (error) {
              this.logger.warn(
                `Failed to kick restricted user ${item.userId} after traffic sync: ${String(error)}`,
              );
            }
          }),
      );

      return {
        nodeId: node.id,
        protocol: node.protocol,
        provisionedUsers,
        impactedUsers: impactedUsers.length,
      };
    } catch (error) {
      try {
        await this.nodes.markSyncFailure(node.id, error);
      } catch (markError) {
        this.logger.warn(
          `Failed to record sync error for node ${node.id}: ${String(markError)}`,
        );
      }
      throw error;
    }
  }

  private withNodeLock<T>(nodeId: string, operation: () => Promise<T>) {
    const existing = this.activeNodeSyncs.get(nodeId);
    if (existing) return existing as Promise<T>;

    const running = operation().finally(() => {
      if (this.activeNodeSyncs.get(nodeId) === running) {
        this.activeNodeSyncs.delete(nodeId);
      }
    });
    this.activeNodeSyncs.set(nodeId, running);
    return running;
  }
}
