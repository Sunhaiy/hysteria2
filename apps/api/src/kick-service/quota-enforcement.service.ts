import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NodeControlService } from '../domain/node-control.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { NodeAdapterRegistry } from '../integrations/node.adapter';

@Injectable()
export class QuotaEnforcementService {
  private readonly logger = new Logger(QuotaEnforcementService.name);
  private readonly nodeWork = new Map<string, Promise<unknown>>();
  private presenceCursor: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeControlService,
    private readonly entitlements: EntitlementService,
    private readonly adapters: NodeAdapterRegistry,
  ) {}

  async withNodeLock<T>(nodeId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.nodeWork.get(nodeId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.nodeWork.set(nodeId, next);
    try {
      return await next;
    } finally {
      if (this.nodeWork.get(nodeId) === next) this.nodeWork.delete(nodeId);
    }
  }

  // Also catches expiry or administrative revocation without a new usage batch.
  async checkOnlineUsers() {
    const rows = await this.prisma.onlinePresence.findMany({
      where: {
        observedAt: { gte: new Date(Date.now() - 180_000) },
        concurrentClients: { gt: 0 },
      },
      orderBy: { id: 'asc' },
      take: 100,
      ...(this.presenceCursor
        ? { cursor: { id: this.presenceCursor }, skip: 1 }
        : {}),
    });
    this.presenceCursor =
      rows.length === 100 ? rows[rows.length - 1].id : undefined;
    for (const row of rows) {
      if (
        !(await this.entitlements.getNodeAccess(row.userId, row.nodeId)).allowed
      ) {
        await this.enqueue(row.userId, row.nodeId);
      }
    }
  }

  // Queue before acknowledging traffic. Retries of an import do not reset backoff
  // or steal a running lease. Even a pack-only user must be checked on every node.
  async enqueue(userId: string, originNodeId: string) {
    const candidates = await this.prisma.node.findMany({
      where: { OR: [{ active: true, retiredAt: null }, { id: originNodeId }] },
      select: { id: true },
    });
    for (const node of candidates) {
      const task = await this.prisma.nodeAccessRevocation.upsert({
        where: { userId_nodeId: { userId, nodeId: node.id } },
        create: { userId, nodeId: node.id },
        update: {},
      });
      await this.prisma.nodeAccessRevocation.updateMany({
        where: { id: task.id, status: { in: ['SUCCEEDED', 'CANCELED'] } },
        data: {
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(),
          leaseToken: null,
          leaseUntil: null,
          completedAt: null,
          lastError: null,
        },
      });
    }
  }

  async processDue(limit = 50) {
    const now = new Date();
    const tasks = await this.prisma.nodeAccessRevocation.findMany({
      where: {
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'RUNNING', leaseUntil: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    // A bounded batch keeps a slow endpoint from delaying all other machines.
    for (let offset = 0; offset < tasks.length; offset += 4) {
      await Promise.all(
        tasks.slice(offset, offset + 4).map(async (task) => {
          const token = randomUUID();
          const claimed = await this.prisma.nodeAccessRevocation.updateMany({
            where: {
              id: task.id,
              OR: [
                { status: 'PENDING', nextAttemptAt: { lte: now } },
                { status: 'RUNNING', leaseUntil: { lte: now } },
              ],
            },
            data: {
              status: 'RUNNING',
              leaseToken: token,
              leaseUntil: new Date(Date.now() + 120_000),
              attempts: { increment: 1 },
            },
          });
          if (!claimed.count) return;
          const owned = { id: task.id, status: 'RUNNING', leaseToken: token };
          await this.withNodeLock(task.nodeId, async () => {
            try {
              const node = await this.nodes.getNodeForControl(task.nodeId);
              if (!node) {
                await this.prisma.nodeAccessRevocation.updateMany({
                  where: owned,
                  data: {
                    status: 'CANCELED',
                    completedAt: new Date(),
                    leaseToken: null,
                    leaseUntil: null,
                  },
                });
                return;
              }
              // Never rely on the permission decision saved at enqueue time. A pack,
              // renewal, check-in or an administrative credit can restore access.
              const access = await this.entitlements.getNodeAccess(
                task.userId,
                task.nodeId,
              );
              if (node.active && access.allowed) {
                await this.prisma.nodeAccessRevocation.updateMany({
                  where: owned,
                  data: {
                    status: 'CANCELED',
                    completedAt: new Date(),
                    lastError: null,
                    leaseToken: null,
                    leaseUntil: null,
                  },
                });
                return;
              }
              // Ensure the lease still belongs to us after resolving current cycles.
              const stillOwned = await this.prisma.nodeAccessRevocation.count({
                where: { ...owned, leaseUntil: { gt: new Date() } },
              });
              if (!stillOwned) return;
              await this.adapters.kickUsers(node, [task.userId]);
              await this.prisma.nodeAccessRevocation.updateMany({
                where: owned,
                data: {
                  status: 'SUCCEEDED',
                  completedAt: new Date(),
                  lastError: null,
                  leaseToken: null,
                  leaseUntil: null,
                },
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              const delay = Math.min(
                60_000,
                2_000 * 2 ** Math.min(task.attempts, 5),
              );
              await this.prisma.nodeAccessRevocation.updateMany({
                where: owned,
                data: {
                  status: 'PENDING',
                  lastError: message.slice(0, 1000),
                  nextAttemptAt: new Date(Date.now() + delay),
                  leaseToken: null,
                  leaseUntil: null,
                },
              });
              this.logger.error(
                `Quota disconnect pending on ${task.nodeId}: ${message}`,
              );
              if (task.attempts === 0 || task.attempts === 5) {
                await this.prisma.auditLog.create({
                  data: {
                    action: 'node.quota_disconnect.failed',
                    targetType: 'NodeAccessRevocation',
                    targetId: task.id,
                    metadata: {
                      nodeId: task.nodeId,
                      userId: task.userId,
                      attempts: task.attempts + 1,
                      error: message.slice(0, 1000),
                    },
                  },
                });
              }
            }
          });
        }),
      );
    }
    return tasks.length;
  }
}
