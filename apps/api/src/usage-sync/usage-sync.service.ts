import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ControlPlaneStoreService,
  type DataRetentionPolicy,
} from '../domain/control-plane.store';
import { NodeControlService } from '../domain/node-control.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { NodeAdapterRegistry } from '../integrations/node.adapter';
import { UnknownTrafficAcknowledgementError } from '../integrations/node-traffic-client.service';
import { QuotaEnforcementService } from '../kick-service/quota-enforcement.service';

@Injectable()
export class UsageSyncService {
  private readonly logger = new Logger(UsageSyncService.name);
  private readonly activeNodeSyncs = new Map<string, Promise<unknown>>();
  private trafficImportTail: Promise<unknown> = Promise.resolve();
  private readonly unknownAckWarnings = new Map<string, number>();
  private readonly deferredAcknowledgements = new Map<
    string,
    { nodeId: string; externalId: string; retryAt: number }
  >();

  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly nodeClient: NodeAdapterRegistry,
    private readonly enforcement: QuotaEnforcementService,
    private readonly entitlements: EntitlementService,
    private readonly nodes: NodeControlService,
  ) {}

  async cleanup(policy: DataRetentionPolicy) {
    return this.store.cleanupOldData(policy);
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

  async syncTrafficNodes() {
    const nodes = (await this.nodes.getNodesForControl()).filter(
      (node) => node.active,
    );
    for (let offset = 0; offset < nodes.length; offset += 3) {
      await Promise.all(
        nodes.slice(offset, offset + 3).map(async (node) => {
          try {
            await this.withNodeLock(
              node.id,
              () => this.syncNodeRecord(node, false),
              'traffic',
            );
          } catch (error) {
            this.logger.warn(
              `Traffic enforcement sync failed on ${node.id}: ${String(error)}`,
            );
          }
        }),
      );
    }
  }

  async reconcileInactiveNodeAcknowledgements() {
    const nodes = (await this.nodes.getNodesForControl()).filter(
      (node) => !node.active,
    );
    for (let offset = 0; offset < nodes.length; offset += 2) {
      await Promise.all(
        nodes.slice(offset, offset + 2).map(async (node) => {
          try {
            await this.withNodeLock(
              node.id,
              () => this.reconcileTrafficAcknowledgements(node),
              'ack',
            );
          } catch (error) {
            this.logger.warn(
              `Traffic acknowledgement recovery failed on ${node.id}: ${String(error)}`,
            );
          }
        }),
      );
    }
  }

  private async syncNodeRecord(
    node: Awaited<ReturnType<NodeControlService['getNodeForControl']>> & object,
    provision = true,
  ) {
    let provisionedUsers = 0;
    let impactedUsers: string[] = [];
    let trafficError: unknown;
    try {
      impactedUsers = await this.importTraffic(node);
    } catch (error) {
      trafficError = error;
    }
    // Provisioning must not depend on traffic collection: a broken traffic
    // endpoint would otherwise block new buyers and leave revoked users in Xray.
    // It runs after a successful import so this batch's exhausted users are out.
    let provisionError: unknown;
    if (provision) {
      try {
        if (node.protocol === 'vless_reality') {
          const users = await this.entitlements.getNodeProvisioningUsers(
            node.id,
          );
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
      } catch (error) {
        provisionError = error;
      }
    }
    const failure = trafficError ?? provisionError;
    if (failure !== undefined) {
      for (const [scope, cause] of [
        ['traffic', trafficError],
        ['users', provisionError],
      ] as const) {
        if (cause === undefined) continue;
        try {
          await this.nodes.markSyncFailure(node.id, cause, scope);
        } catch (markError) {
          this.logger.warn(
            `Failed to record ${scope} sync error for node ${node.id}: ${String(markError)}`,
          );
        }
      }
      throw failure instanceof Error
        ? failure
        : new Error(JSON.stringify(failure));
    }
    return {
      nodeId: node.id,
      protocol: node.protocol,
      provisionedUsers,
      impactedUsers: impactedUsers.length,
    };
  }

  private async importTraffic(
    node: Awaited<ReturnType<NodeControlService['getNodeForControl']>> & object,
  ) {
    await this.reconcileTrafficAcknowledgements(node);
    const batch = await this.nodeClient.claimTrafficBatch(node);
    // Different nodes often meter the same accounts in different orders.
    // Keep remote collection concurrent but serialize worker-owned billing.
    const imported = this.trafficImportTail
      .catch(() => undefined)
      .then(() => this.entitlements.applyTrafficBatch(node.id, batch));
    this.trafficImportTail = imported;
    const { impactedUsers } = await imported;

    for (const userId of impactedUsers) {
      if (!(await this.entitlements.getNodeAccess(userId, node.id)).allowed) {
        // Queue must be durable before the import is acknowledged.
        await this.enforcement.enqueue(userId, node.id);
      }
    }
    await this.store.markTrafficEnforcementQueued(node.id, batch.id);

    await this.nodeClient.acknowledgeTrafficBatch(node, batch.id);
    await this.store.acknowledgeTrafficBatch(node.id, batch.id);
    await this.nodes.markTrafficSyncSuccess(node.id);
    return impactedUsers;
  }

  private async reconcileTrafficAcknowledgements(
    node: Awaited<ReturnType<NodeControlService['getNodeForControl']>> & object,
  ) {
    const deferredIds: string[] = [];
    for (const [key, receipt] of this.deferredAcknowledgements) {
      if (receipt.retryAt <= Date.now())
        this.deferredAcknowledgements.delete(key);
      else if (receipt.nodeId === node.id) deferredIds.push(receipt.externalId);
    }
    const pending = await this.store.getPendingTrafficAcknowledgements(
      node.id,
      deferredIds,
    );
    for (const batch of pending) {
      if (!batch.enforcementQueuedAt) {
        for (const { userId } of batch.rollups) {
          if (!(await this.entitlements.getNodeAccess(userId, node.id)).allowed)
            await this.enforcement.enqueue(userId, node.id);
        }
        await this.store.markTrafficEnforcementQueued(
          node.id,
          batch.externalId,
        );
      }
      try {
        await this.nodeClient.acknowledgeTrafficBatch(node, batch.externalId);
        await this.store.acknowledgeTrafficBatch(node.id, batch.externalId);
      } catch (error) {
        if (!(error instanceof UnknownTrafficAcknowledgementError)) throw error;
        if (this.deferredAcknowledgements.size >= 1024) {
          const oldest = [...this.deferredAcknowledgements.keys()][0];
          if (oldest) this.deferredAcknowledgements.delete(oldest);
        }
        this.deferredAcknowledgements.set(`${node.id}:${batch.externalId}`, {
          nodeId: node.id,
          externalId: batch.externalId,
          retryAt: Date.now() + 60_000,
        });
        // Old Agents have no durable receipt history. Keep these rows APPLIED
        // for investigation; never invent an ACK, replay billing, or starve
        // fresh traffic behind unverifiable history.
        const lastWarning = this.unknownAckWarnings.get(node.id) ?? 0;
        if (Date.now() - lastWarning > 60_000) {
          this.logger.warn(
            `Historical traffic acknowledgement requires reconciliation on ${node.id}`,
          );
          this.unknownAckWarnings.set(node.id, Date.now());
        }
      }
    }
  }

  private withNodeLock<T>(
    nodeId: string,
    operation: () => Promise<T>,
    mode = 'full',
  ) {
    const key = `${mode}:${nodeId}`;
    const existing = this.activeNodeSyncs.get(key);
    if (existing) return existing as Promise<T>;

    const running = this.enforcement
      .withNodeLock(nodeId, operation)
      .finally(() => {
        if (this.activeNodeSyncs.get(key) === running) {
          this.activeNodeSyncs.delete(key);
        }
      });
    this.activeNodeSyncs.set(key, running);
    return running;
  }
}
