import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
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
  ) {}

  @Interval(60_000)
  async scheduledSync() {
    if (
      process.env.NODE_SYNC_ENABLED !== 'true' &&
      process.env.HYSTERIA_SYNC_ENABLED !== 'true'
    ) {
      return;
    }
    await this.syncAllNodes();
  }

  @Interval(24 * 60 * 60 * 1000)
  async scheduledCleanup() {
    const retentionDays = parseInt(process.env.DATA_RETENTION_DAYS ?? '30', 10);
    const result = await this.store.cleanupOldData(retentionDays);
    this.logger.log(
      `Cleanup: removed ${result.deletedSnapshots} snapshots, ${result.deletedAuthEvents} auth events older than ${retentionDays} days`,
    );
  }

  async syncAllNodes() {
    const nodes = (await this.store.getNodesForControl()).filter(
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
    const node = await this.store.getNodeForControl(nodeId);
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
    node: Awaited<ReturnType<ControlPlaneStoreService['getNodeForControl']>> &
      object,
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

      const batch = await this.nodeClient.claimTrafficBatch(node);
      const applied = await this.entitlements.applyTrafficBatch(node.id, batch);
      await this.nodeClient.acknowledgeTrafficBatch(node, batch.id);
      await this.store.acknowledgeTrafficBatch(node.id, batch.id);
      const impactedUsers = applied.impactedUsers;
      const online = await this.nodeClient.fetchOnline(node);
      await this.store.applyOnlineSnapshot(node.id, online);

      const restrictionChecks = await Promise.all(
        impactedUsers.map(async (userId) => ({
          userId,
          restricted: !(await this.entitlements.getNodeAccess(userId, node.id))
            .allowed,
        })),
      );

      await Promise.all(
        restrictionChecks
          .filter((item) => item.restricted)
          .map((item) =>
            this.kickService.kickUserEverywhere(item.userId, 'usage-sync'),
          ),
      );

      await this.store.markNodeSyncSuccess(node.id);
      return {
        nodeId: node.id,
        protocol: node.protocol,
        provisionedUsers,
        impactedUsers: impactedUsers.length,
        onlineUsers: Object.keys(online).length,
      };
    } catch (error) {
      try {
        await this.store.markNodeSyncFailure(node.id, error);
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
