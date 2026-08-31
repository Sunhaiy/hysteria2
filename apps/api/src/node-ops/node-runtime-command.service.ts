import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  NodeProtocol,
  NodeRuntimeAction,
  NodeRuntimeCommandStatus,
  NodeRuntimeState,
  Prisma,
} from '@prisma/client';
import { NodeControlService } from '../domain/node-control.service';
import { NodeAdapterRegistry } from '../integrations/node.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { UsageSyncService } from '../usage-sync/usage-sync.service';
import type { RequestNodeRuntimeCommandDto } from './node-ops.dto';

const runtimeStates = new Set([
  'unknown',
  'active',
  'inactive',
  'activating',
  'deactivating',
  'failed',
]);

@Injectable()
export class NodeRuntimeCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: NodeAdapterRegistry,
    private readonly nodes: NodeControlService,
    @Optional() private readonly usageSync?: UsageSyncService,
  ) {}

  async request(
    nodeId: string,
    input: RequestNodeRuntimeCommandDto,
    requestedById: string,
  ) {
    return this.enqueue(
      nodeId,
      input,
      requestedById,
      `node.runtime.${input.action}.requested`,
    );
  }

  async requestSystemStop(
    nodeId: string,
    idempotencyKey: string,
    metadata: Record<string, string>,
  ) {
    return this.enqueue(
      nodeId,
      { action: 'stop', idempotencyKey },
      null,
      'node.runtime.stop.auto_requested',
      metadata,
    );
  }

  async requestSystemStart(
    nodeId: string,
    idempotencyKey: string,
    metadata: Record<string, string>,
  ) {
    return this.enqueue(
      nodeId,
      { action: 'start', idempotencyKey },
      null,
      'node.runtime.start.system_requested',
      metadata,
    );
  }

  private async enqueue(
    nodeId: string,
    input: RequestNodeRuntimeCommandDto,
    requestedById: string | null,
    auditAction: string,
    auditMetadata: Record<string, string> = {},
  ) {
    const action = input.action.toUpperCase() as NodeRuntimeAction;
    try {
      const command = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.nodeRuntimeCommand.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          if (existing.nodeId !== nodeId || existing.action !== action) {
            throw new ConflictException(
              'Idempotency key belongs to another runtime command',
            );
          }
          return existing;
        }

        const node = await tx.node.findUnique({
          where: { id: nodeId, retiredAt: null },
          select: {
            id: true,
            protocol: true,
            controlApiBaseUrl: true,
            controlApiSecret: true,
            server: { select: { active: true } },
          },
        });
        if (!node) throw new NotFoundException('Node not found');
        if (
          action === NodeRuntimeAction.START &&
          node.server &&
          !node.server.active
        ) {
          throw new ConflictException('服务器已停止，请先恢复整台服务器');
        }
        if (
          node.protocol === NodeProtocol.HYSTERIA2 &&
          (!node.controlApiBaseUrl || !node.controlApiSecret)
        ) {
          throw new BadRequestException(
            'Hysteria2 runtime control agent is not configured',
          );
        }

        const active = await tx.nodeRuntimeCommand.findFirst({
          where: {
            nodeId,
            status: {
              in: [
                NodeRuntimeCommandStatus.QUEUED,
                NodeRuntimeCommandStatus.RUNNING,
              ],
            },
          },
        });
        if (active) {
          throw new ConflictException(
            'Another runtime command is already pending for this node',
          );
        }

        const created = await tx.nodeRuntimeCommand.create({
          data: {
            nodeId,
            requestedById,
            action,
            idempotencyKey: input.idempotencyKey,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: requestedById,
            action: auditAction,
            targetType: 'node',
            targetId: nodeId,
            metadata: { commandId: created.id, ...auditMetadata },
          },
        });
        return created;
      });
      return this.present(command);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.nodeRuntimeCommand.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (
          existing &&
          existing.nodeId === nodeId &&
          existing.action === action
        ) {
          return this.present(existing);
        }
        throw new ConflictException(
          'Another runtime command is already pending for this node',
        );
      }
      throw error;
    }
  }

  async get(nodeId: string, commandId: string) {
    const command = await this.prisma.nodeRuntimeCommand.findFirst({
      where: { id: commandId, nodeId },
    });
    if (!command) throw new NotFoundException('Runtime command not found');
    return this.present(command);
  }

  async processPending(limit = 10) {
    const processed = [];
    for (let index = 0; index < limit; index += 1) {
      const command = await this.processNext();
      if (!command) break;
      processed.push(command);
    }
    return processed;
  }

  async processNext() {
    const command = await this.prisma.nodeRuntimeCommand.findFirst({
      where: { status: NodeRuntimeCommandStatus.QUEUED },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
    });
    if (!command) return null;

    const claimed = await this.prisma.nodeRuntimeCommand.updateMany({
      where: {
        id: command.id,
        status: NodeRuntimeCommandStatus.QUEUED,
      },
      data: {
        status: NodeRuntimeCommandStatus.RUNNING,
        startedAt: new Date(),
        attemptCount: { increment: 1 },
        error: null,
      },
    });
    if (claimed.count !== 1) return null;

    try {
      const node = await this.nodes.getNodeForRuntimeCommand(command.nodeId);
      if (!node) throw new Error('Node no longer exists');
      let forcedRetirementStop = Boolean(node.retiredAt);
      let result = forcedRetirementStop
        ? await this.adapters.controlService(
            node,
            'stop',
            `retirement:${command.idempotencyKey}`,
          )
        : command.action === NodeRuntimeAction.STATUS
          ? await this.adapters.getServiceStatus(node)
          : await this.adapters.controlService(
              node,
              command.action === NodeRuntimeAction.START ? 'start' : 'stop',
              command.idempotencyKey,
            );
      let state = this.parseState(result.status);
      if (!forcedRetirementStop && command.action === NodeRuntimeAction.START) {
        const latest = await this.prisma.node.findUnique({
          where: { id: command.nodeId },
          select: { retiredAt: true },
        });
        if (latest?.retiredAt) {
          forcedRetirementStop = true;
          result = await this.adapters.controlService(
            node,
            'stop',
            `retirement:${command.idempotencyKey}`,
          );
          state = this.parseState(result.status);
        }
      }
      const expectedAction = forcedRetirementStop
        ? NodeRuntimeAction.STOP
        : command.action;
      if (
        (expectedAction === NodeRuntimeAction.START &&
          state !== NodeRuntimeState.ACTIVE) ||
        (expectedAction === NodeRuntimeAction.STOP &&
          state !== NodeRuntimeState.INACTIVE)
      ) {
        throw new Error(
          `Agent reported ${result.status} after ${expectedAction.toLowerCase()}`,
        );
      }
      const observedAt = this.parseObservedAt(result.observedAt);
      const completedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.node.update({
          where: { id: command.nodeId },
          data: {
            runtimeState: state,
            runtimeStateObservedAt: observedAt,
            runtimeError: null,
          },
        });
        await tx.nodeRuntimeCommand.update({
          where: { id: command.id },
          data: {
            status: NodeRuntimeCommandStatus.SUCCEEDED,
            resultState: state,
            error: null,
            completedAt,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: command.requestedById,
            action: `node.runtime.${command.action.toLowerCase()}.succeeded`,
            targetType: 'node',
            targetId: command.nodeId,
            metadata: {
              commandId: command.id,
              state: result.status,
              forcedRetirementStop,
            },
          },
        });
      });
      if (
        command.action === NodeRuntimeAction.START &&
        node.protocol === 'vless_reality' &&
        node.active &&
        this.usageSync
      ) {
        try {
          await this.usageSync.syncNode(node.id);
        } catch (syncError) {
          await this.prisma.auditLog.create({
            data: {
              actorId: command.requestedById,
              action: 'node.runtime.start.sync_failed',
              targetType: 'node',
              targetId: command.nodeId,
              metadata: {
                commandId: command.id,
                error: this.errorMessage(syncError),
              },
            },
          });
        }
      }
      return this.present({
        ...command,
        status: NodeRuntimeCommandStatus.SUCCEEDED,
        resultState: state,
        completedAt,
        error: null,
      });
    } catch (error) {
      const message = this.errorMessage(error);
      const completedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.nodeRuntimeCommand.update({
          where: { id: command.id },
          data: {
            status: NodeRuntimeCommandStatus.FAILED,
            error: message,
            completedAt,
          },
        });
        await tx.node.update({
          where: { id: command.nodeId },
          data: { runtimeError: message },
        });
        await tx.auditLog.create({
          data: {
            actorId: command.requestedById,
            action: `node.runtime.${command.action.toLowerCase()}.failed`,
            targetType: 'node',
            targetId: command.nodeId,
            metadata: { commandId: command.id, error: message },
          },
        });
      });
      return this.present({
        ...command,
        status: NodeRuntimeCommandStatus.FAILED,
        completedAt,
        error: message,
      });
    }
  }

  async recoverAbandonedCommands() {
    return this.prisma.nodeRuntimeCommand.updateMany({
      where: {
        status: NodeRuntimeCommandStatus.RUNNING,
        startedAt: { lt: new Date(Date.now() - 2 * 60_000) },
      },
      data: {
        status: NodeRuntimeCommandStatus.QUEUED,
        startedAt: null,
        error: 'Recovered after worker interruption',
      },
    });
  }

  async refreshRuntimeStatuses() {
    const nodes = (await this.nodes.getNodesForControl()).filter(
      (node) => node.runtimeControlConfigured,
    );
    return Promise.all(
      nodes.map(async (node) => {
        try {
          const result = await this.adapters.getServiceStatus(node);
          const state = this.parseState(result.status);
          await this.prisma.node.update({
            where: { id: node.id },
            data: {
              runtimeState: state,
              runtimeStateObservedAt: this.parseObservedAt(result.observedAt),
              runtimeError: null,
            },
          });
          return { nodeId: node.id, state: result.status };
        } catch (error) {
          const message = this.errorMessage(error);
          await this.prisma.node.update({
            where: { id: node.id },
            data: { runtimeError: message },
          });
          return { nodeId: node.id, error: message };
        }
      }),
    );
  }

  private parseState(value: string) {
    if (!runtimeStates.has(value)) {
      throw new Error(`Agent returned unsupported runtime state: ${value}`);
    }
    return value.toUpperCase() as NodeRuntimeState;
  }

  private parseObservedAt(value: string) {
    const observedAt = new Date(value);
    if (Number.isNaN(observedAt.getTime())) {
      throw new Error('Agent returned an invalid observation time');
    }
    return observedAt;
  }

  private errorMessage(error: unknown) {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      1000,
    );
  }

  private present(command: {
    id: string;
    nodeId: string;
    requestedById: string | null;
    action: NodeRuntimeAction;
    status: NodeRuntimeCommandStatus;
    idempotencyKey: string;
    attemptCount: number;
    resultState: NodeRuntimeState | null;
    error: string | null;
    requestedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }) {
    return {
      ...command,
      action: command.action.toLowerCase(),
      status: command.status.toLowerCase(),
      resultState: command.resultState?.toLowerCase() ?? null,
      requestedAt: command.requestedAt.toISOString(),
      startedAt: command.startedAt?.toISOString() ?? null,
      completedAt: command.completedAt?.toISOString() ?? null,
    };
  }
}
