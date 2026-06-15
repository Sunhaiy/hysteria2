import { Injectable, Logger } from '@nestjs/common';
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
    if (process.env.HYSTERIA_SYNC_ENABLED !== 'true') {
      return;
    }
    await this.syncAllNodes();
  }

  @Interval(24 * 60 * 60 * 1000)
  async scheduledCleanup() {
    const retentionDays = parseInt(
      process.env.DATA_RETENTION_DAYS ?? '30',
      10,
    );
    const result = await this.store.cleanupOldData(retentionDays);
    this.logger.log(
      `Cleanup: removed ${result.deletedSnapshots} snapshots, ${result.deletedAuthEvents} auth events older than ${retentionDays} days`,
    );
  }

  async syncAllNodes() {
    const nodes = (await this.store.getNodes()).filter((node) => node.active);

    const settled = await Promise.allSettled(
      nodes.map(async (node) => {
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

        return {
          nodeId: node.id,
          impactedUsers: impactedUsers.length,
          onlineUsers: Object.keys(online).length,
        };
      }),
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
}
