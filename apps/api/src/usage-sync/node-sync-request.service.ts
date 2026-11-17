import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { NodeControlService } from '../domain/node-control.service';
import { UsageSyncService } from './usage-sync.service';

const pendingKey = 'node-sync:requests';
const requestTtlSeconds = 120;
const maximumBatchSize = 4;

@Injectable()
export class NodeSyncRequestService {
  private readonly logger = new Logger(NodeSyncRequestService.name);
  private processing = false;

  constructor(
    private readonly cache: CacheService,
    private readonly nodes: NodeControlService,
    private readonly sync: UsageSyncService,
  ) {}

  async request(nodeId: string) {
    if (!this.syncEnabled()) {
      throw new ServiceUnavailableException('节点同步尚未启用');
    }
    const node = await this.nodes.getNodeForControl(nodeId);
    if (!node) throw new NotFoundException(`Unknown node: ${nodeId}`);
    if (!node.active)
      throw new BadRequestException(`Node is disabled: ${nodeId}`);

    const requireRedis = process.env.NODE_ENV === 'production';
    try {
      const health = await this.cache.health();
      if (!health.ok || (requireRedis && health.adapter !== 'redis')) {
        throw new Error('Shared queue unavailable');
      }
      // One member per validated node bounds duplicate requests by fleet size.
      // The timestamp expires separately so requests surviving a worker outage
      // cannot unexpectedly perform an old administrator action after recovery.
      await this.cache.set(
        this.requestKey(nodeId),
        new Date().toISOString(),
        requestTtlSeconds,
        requireRedis,
      );
      await this.cache.addMember(pendingKey, nodeId, requireRedis);
    } catch {
      throw new ServiceUnavailableException(
        '节点同步请求队列暂不可用，请稍后重试',
      );
    }
    return { accepted: true, nodeId };
  }

  // Only the single sync worker calls this method. API handlers enqueue above.
  async processPending() {
    const results: Array<{
      nodeId: string;
      status: 'succeeded' | 'failed' | 'expired';
    }> = [];
    if (!this.syncEnabled() || this.processing) return results;
    this.processing = true;
    const requireRedis = process.env.NODE_ENV === 'production';
    try {
      const pending = (
        await this.cache.members(pendingKey, requireRedis)
      ).slice(0, maximumBatchSize);
      for (const nodeId of pending) {
        // Consume first: a failed manual run falls back to the routine full sync,
        // instead of retrying forever at the administrator poll frequency.
        await this.cache.removeMember(pendingKey, nodeId, requireRedis);
        const requestedAt = await this.cache.get(
          this.requestKey(nodeId),
          requireRedis,
        );
        await this.cache.del(this.requestKey(nodeId), requireRedis);
        const requestedTime = requestedAt ? Date.parse(requestedAt) : NaN;
        if (
          !Number.isFinite(requestedTime) ||
          Date.now() - requestedTime > requestTtlSeconds * 1000
        ) {
          results.push({ nodeId, status: 'expired' });
          continue;
        }
        try {
          await this.sync.syncNode(nodeId);
          results.push({ nodeId, status: 'succeeded' });
        } catch (error) {
          this.logger.warn(
            `Requested node sync failed for ${nodeId}: ${String(error)}`,
          );
          results.push({ nodeId, status: 'failed' });
        }
      }
      return results;
    } finally {
      this.processing = false;
    }
  }

  private syncEnabled() {
    return (
      process.env.NODE_SYNC_ENABLED === 'true' ||
      process.env.HYSTERIA_SYNC_ENABLED === 'true'
    );
  }

  private requestKey(nodeId: string) {
    return `${pendingKey}:${nodeId}`;
  }
}
