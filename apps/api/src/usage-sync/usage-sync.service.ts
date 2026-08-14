import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { NodeTrafficClientService } from '../integrations/node-traffic-client.service';
import { KickService } from '../kick-service/kick-service.service';

@Injectable()
export class UsageSyncService {
  private readonly logger = new Logger(UsageSyncService.name);

  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly nodeClient: NodeTrafficClientService,
    private readonly kickService: KickService,
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
    const nodes = (await this.store.getNodes()).filter((node) => node.active);

    const settled = await Promise.allSettled(
      nodes.map((node) => this.syncNodeRecord(node)),
    );

    return settled.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      this.logger.warn(
        `Failed to sync node ${nodes[i].id}: ${String(result.reason)}`,
      );
      return { nodeId: nodes[i].id, error: String(result.reason) };
    });
  }

  async syncNode(nodeId: string) {
    const node = await this.store.getNodeById(nodeId);
    if (!node) throw new NotFoundException(`Unknown node: ${nodeId}`);
    if (!node.active) {
      throw new BadRequestException(`Node is disabled: ${nodeId}`);
    }
    try {
      return await this.syncNodeRecord(node);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadGatewayException(`Node sync failed: ${message}`);
    }
  }

  private async syncNodeRecord(
    node: Awaited<ReturnType<ControlPlaneStoreService['getNodeById']>> & object,
  ) {
    try {
      let provisionedUsers = 0;
      if (node.protocol === 'vless_reality') {
        const users = await this.store.getNodeProvisioningUsers(node.id);
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

      const traffic = await this.nodeClient.fetchTraffic(node);
      const impactedUsers = await this.store.applyTrafficSnapshot(
        node.id,
        traffic,
      );
      await this.nodeClient.clearTraffic(node);
      const online = await this.nodeClient.fetchOnline(node);
      await this.store.applyOnlineSnapshot(node.id, online);

      const restrictionChecks = await Promise.all(
        impactedUsers.map(async (userId) => ({
          userId,
          restricted: await this.store.validateUserIsRestricted(userId),
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
}
