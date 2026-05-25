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

  @Interval(60000)
  async scheduledSync() {
    if (process.env.HYSTERIA_SYNC_ENABLED !== 'true') {
      return;
    }
    await this.syncAllNodes();
  }

  async syncAllNodes() {
    const nodes = (await this.store.getNodes()).filter((node) => node.active);
    const results = [];
    for (const node of nodes) {
      try {
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

        results.push({
          nodeId: node.id,
          impactedUsers: impactedUsers.length,
          onlineUsers: Object.keys(online).length,
        });
      } catch (error) {
        this.logger.warn(`Failed to sync node ${node.id}: ${String(error)}`);
        results.push({
          nodeId: node.id,
          error: String(error),
        });
      }
    }
    return results;
  }
}
