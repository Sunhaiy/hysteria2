import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NodeLifecycleStatus,
  NodeProtocol,
  NodeRuntimeCommandStatus,
  NodeRuntimeState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateNodeTrafficLimitDto } from './node-ops.dto';
import { NodeRuntimeCommandService } from './node-runtime-command.service';

const bytesPerGiB = BigInt(1024 ** 3);
const beijingOffsetMs = 8 * 60 * 60 * 1000;

export type ServerTrafficGuardEndpoint = {
  id: string;
  protocol: NodeProtocol;
  controlApiBaseUrl: string | null;
  controlApiSecret: string | null;
  runtimeState: NodeRuntimeState;
  runtimeStateObservedAt: Date | null;
  retiredAt: Date | null;
};

export type ServerTrafficGuardSubject = {
  id: string;
  active: boolean;
  trafficLimitEnabled: boolean;
  trafficLimitBytes: bigint | null;
  trafficLimitResetDay: number;
  retiredAt: Date | null;
  endpoints: ServerTrafficGuardEndpoint[];
};

type TrafficCycle = { start: Date; end: Date };
type UsageRow = { nodeId: string; physicalBytes: bigint };
type GuardCommand = {
  nodeId: string;
  status: NodeRuntimeCommandStatus;
  idempotencyKey: string;
};

export type NodeTrafficGuardProjection = {
  enabled: boolean;
  configured: boolean;
  limitGiB: number | null;
  limitBytes: number | null;
  resetDay: number;
  usedBytes: number;
  remainingBytes: number | null;
  usagePercent: number;
  thresholdReached: boolean;
  cycleStart: string;
  cycleEnd: string;
  nextResetAt: string;
  stopCommandStatus: string | null;
  status:
    | 'disabled'
    | 'unavailable'
    | 'monitoring'
    | 'limit_reached'
    | 'stop_queued'
    | 'stopped';
};

@Injectable()
export class NodeTrafficGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: NodeRuntimeCommandService,
  ) {}

  async project(subjects: ServerTrafficGuardSubject[], now = new Date()) {
    return (await this.collect(subjects, now)).projections;
  }

  async updatePolicy(
    serverId: string,
    input: UpdateNodeTrafficLimitDto,
    actorId: string,
  ) {
    const existing = await this.prisma.nodeServer.findFirst({
      where: { id: serverId, retiredAt: null },
      include: {
        endpoints: {
          where: { retiredAt: null },
          select: {
            id: true,
            protocol: true,
            controlApiBaseUrl: true,
            controlApiSecret: true,
            runtimeState: true,
            runtimeStateObservedAt: true,
            retiredAt: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('Node server not found');

    const trafficLimitBytes = BigInt(
      Math.round(input.monthlyLimitGiB * Number(bytesPerGiB)),
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const server = await tx.nodeServer.update({
        where: { id: serverId },
        data: {
          trafficLimitEnabled: input.enabled,
          trafficLimitBytes,
          trafficLimitResetDay: input.resetDay,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'server.traffic_limit.updated',
          targetType: 'node_server',
          targetId: serverId,
          metadata: {
            enabled: input.enabled,
            monthlyLimitGiB: input.monthlyLimitGiB,
            resetDay: input.resetDay,
          },
        },
      });
      return server;
    });
    return (
      await this.project([{ ...updated, endpoints: existing.endpoints }])
    ).get(serverId);
  }

  async updatePolicyForNode(
    nodeId: string,
    input: UpdateNodeTrafficLimitDto,
    actorId: string,
  ) {
    const node = await this.prisma.node.findFirst({
      where: { id: nodeId, retiredAt: null },
      select: { serverId: true },
    });
    if (!node) throw new NotFoundException('Node not found');
    if (!node.serverId) {
      throw new BadRequestException('未归属服务器的节点不能设置服务器流量保护');
    }
    return this.updatePolicy(node.serverId, input, actorId);
  }

  async enforce(now = new Date()) {
    const subjects = await this.prisma.nodeServer.findMany({
      where: {
        retiredAt: null,
        trafficLimitEnabled: true,
        trafficLimitBytes: { not: null },
      },
      select: {
        id: true,
        active: true,
        trafficLimitEnabled: true,
        trafficLimitBytes: true,
        trafficLimitResetDay: true,
        retiredAt: true,
        endpoints: {
          where: { retiredAt: null },
          select: {
            id: true,
            protocol: true,
            controlApiBaseUrl: true,
            controlApiSecret: true,
            runtimeState: true,
            runtimeStateObservedAt: true,
            retiredAt: true,
          },
        },
      },
    });
    const collected = await this.collect(subjects, now);
    let disabled = 0;
    let queued = 0;
    let skipped = 0;

    for (const subject of subjects) {
      const projection = collected.projections.get(subject.id);
      if (!projection?.thresholdReached) {
        skipped += 1;
        continue;
      }

      if (subject.active) {
        await this.prisma.$transaction(async (tx) => {
          await tx.node.updateMany({
            where: { serverId: subject.id, retiredAt: null },
            data: {
              active: false,
              lifecycleStatus: NodeLifecycleStatus.DISABLED,
            },
          });
          await tx.nodeServer.update({
            where: { id: subject.id },
            data: { active: false },
          });
          await tx.auditLog.create({
            data: {
              actorId: null,
              action: 'server.traffic_limit.access_disabled',
              targetType: 'node_server',
              targetId: subject.id,
              metadata: {
                cycleStart: projection.cycleStart,
                cycleEnd: projection.cycleEnd,
                limitBytes: String(subject.trafficLimitBytes),
                usedBytes: String(
                  collected.usageByServer.get(subject.id) ?? BigInt(0),
                ),
              },
            },
          });
        });
        disabled += 1;
      }

      const cycle = this.trafficCycle(now, subject.trafficLimitResetDay);
      for (const endpoint of subject.endpoints) {
        if (
          endpoint.runtimeState === NodeRuntimeState.INACTIVE ||
          !this.runtimeControlConfigured(endpoint) ||
          collected.pendingNodeIds.has(endpoint.id)
        ) {
          skipped += 1;
          continue;
        }
        const idempotencyKey = this.commandKey(
          subject.id,
          endpoint,
          cycle.start,
          now,
        );
        if (collected.commandsByKey.has(idempotencyKey)) {
          skipped += 1;
          continue;
        }
        try {
          await this.runtime.requestSystemStop(endpoint.id, idempotencyKey, {
            serverId: subject.id,
            cycleStart: cycle.start.toISOString(),
            cycleEnd: cycle.end.toISOString(),
            limitBytes: String(subject.trafficLimitBytes),
            usedBytes: String(
              collected.usageByServer.get(subject.id) ?? BigInt(0),
            ),
          });
          queued += 1;
        } catch (error) {
          if (
            error instanceof ConflictException ||
            error instanceof BadRequestException ||
            error instanceof NotFoundException
          ) {
            skipped += 1;
            continue;
          }
          throw error;
        }
      }
    }
    return { checked: subjects.length, disabled, queued, skipped };
  }

  private async collect(subjects: ServerTrafficGuardSubject[], now: Date) {
    const projections = new Map<string, NodeTrafficGuardProjection>();
    const commandsByKey = new Map<string, GuardCommand>();
    const usageByServer = new Map<string, bigint>();
    const pendingNodeIds = new Set<string>();
    if (subjects.length === 0) {
      return {
        projections,
        commandsByKey,
        usageByServer,
        pendingNodeIds,
      };
    }

    const cycles = new Map(
      subjects.map((subject) => [
        subject.id,
        this.trafficCycle(now, subject.trafficLimitResetDay),
      ]),
    );
    const endpointOwners = new Map<string, string>();
    const usageConditions: Prisma.Sql[] = [];
    const commandConditions: Prisma.NodeRuntimeCommandWhereInput[] = [];
    const limitedSubjects = subjects.filter(
      (subject) =>
        subject.trafficLimitEnabled && subject.trafficLimitBytes !== null,
    );
    for (const subject of limitedSubjects) {
      const cycle = cycles.get(subject.id)!;
      for (const endpoint of subject.endpoints) {
        endpointOwners.set(endpoint.id, subject.id);
        usageConditions.push(Prisma.sql`(
          rollup."nodeId" = ${endpoint.id}
          AND rollup."bucketStart" >= ${cycle.start}
          AND rollup."bucketStart" < ${cycle.end}
        )`);
        commandConditions.push({
          nodeId: endpoint.id,
          idempotencyKey: {
            startsWith: this.commandPrefix(
              subject.id,
              endpoint.id,
              cycle.start,
            ),
          },
        });
      }
    }

    if (usageConditions.length > 0) {
      const usageRows = await this.prisma.$queryRaw<UsageRow[]>(Prisma.sql`
        SELECT
          rollup."nodeId",
          COALESCE(
            SUM(COALESCE(rollup."rawBytes", rollup."txBytes" + rollup."rxBytes")),
            0
          )::bigint AS "physicalBytes"
        FROM "UsageRollup" AS rollup
        WHERE ${Prisma.join(usageConditions, ' OR ')}
        GROUP BY rollup."nodeId"
      `);
      for (const row of usageRows) {
        const serverId = endpointOwners.get(row.nodeId);
        if (!serverId) continue;
        usageByServer.set(
          serverId,
          (usageByServer.get(serverId) ?? BigInt(0)) +
            BigInt(row.physicalBytes),
        );
      }
    }

    const commands =
      commandConditions.length > 0
        ? await this.prisma.nodeRuntimeCommand.findMany({
            where: { OR: commandConditions },
            select: { nodeId: true, status: true, idempotencyKey: true },
            orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
          })
        : [];
    const latestCommandByServer = new Map<string, GuardCommand>();
    for (const command of commands) {
      commandsByKey.set(command.idempotencyKey, command);
      if (
        command.status === NodeRuntimeCommandStatus.QUEUED ||
        command.status === NodeRuntimeCommandStatus.RUNNING
      ) {
        pendingNodeIds.add(command.nodeId);
      }
      const serverId = endpointOwners.get(command.nodeId);
      if (serverId && !latestCommandByServer.has(serverId)) {
        latestCommandByServer.set(serverId, command);
      }
    }

    for (const subject of subjects) {
      const cycle = cycles.get(subject.id)!;
      const limit = subject.trafficLimitBytes;
      const used = usageByServer.get(subject.id) ?? BigInt(0);
      const remaining = limit === null ? null : limit - used;
      const thresholdReached = limit !== null && used >= limit;
      const command = latestCommandByServer.get(subject.id);
      const configured =
        subject.endpoints.length > 0 &&
        subject.endpoints.every((endpoint) =>
          this.runtimeControlConfigured(endpoint),
        );
      projections.set(subject.id, {
        enabled: subject.trafficLimitEnabled,
        configured,
        limitGiB: limit === null ? null : Number(limit) / Number(bytesPerGiB),
        limitBytes: limit === null ? null : this.safeNumber(limit),
        resetDay: subject.trafficLimitResetDay,
        usedBytes: this.safeNumber(used),
        remainingBytes:
          remaining === null
            ? null
            : this.safeNumber(remaining > BigInt(0) ? remaining : BigInt(0)),
        usagePercent:
          limit === null ? 0 : Number((used * BigInt(10_000)) / limit) / 100,
        thresholdReached,
        cycleStart: cycle.start.toISOString(),
        cycleEnd: cycle.end.toISOString(),
        nextResetAt: cycle.end.toISOString(),
        stopCommandStatus: command?.status.toLowerCase() ?? null,
        status: this.statusFor(subject, configured, thresholdReached, command),
      });
    }
    return { projections, commandsByKey, usageByServer, pendingNodeIds };
  }

  private trafficCycle(now: Date, resetDay: number): TrafficCycle {
    const local = new Date(now.getTime() + beijingOffsetMs);
    const year = local.getUTCFullYear();
    const month = local.getUTCMonth();
    const resetThisMonth = Date.UTC(year, month, resetDay) - beijingOffsetMs;
    const startsThisMonth = now.getTime() >= resetThisMonth;
    const startMonth = startsThisMonth ? month : month - 1;
    const start = new Date(
      Date.UTC(year, startMonth, resetDay) - beijingOffsetMs,
    );
    const end = new Date(
      Date.UTC(year, startMonth + 1, resetDay) - beijingOffsetMs,
    );
    return { start, end };
  }

  private runtimeControlConfigured(subject: {
    protocol: NodeProtocol;
    controlApiBaseUrl: string | null;
    controlApiSecret: string | null;
  }) {
    return (
      subject.protocol === NodeProtocol.VLESS_REALITY ||
      Boolean(subject.controlApiBaseUrl && subject.controlApiSecret)
    );
  }

  private commandPrefix(serverId: string, nodeId: string, cycleStart: Date) {
    return `server-traffic-limit:${serverId}:${cycleStart.toISOString()}:${nodeId}:`;
  }

  private commandKey(
    serverId: string,
    endpoint: ServerTrafficGuardEndpoint,
    cycleStart: Date,
    now: Date,
  ) {
    const retryWindow = Math.floor(now.getTime() / 60_000);
    return `${this.commandPrefix(serverId, endpoint.id, cycleStart)}${endpoint.runtimeStateObservedAt?.getTime() ?? 0}:${retryWindow}`;
  }

  private safeNumber(value: bigint) {
    return Number(
      value > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : value,
    );
  }

  private statusFor(
    subject: ServerTrafficGuardSubject,
    configured: boolean,
    thresholdReached: boolean,
    command?: GuardCommand,
  ): NodeTrafficGuardProjection['status'] {
    if (!subject.trafficLimitEnabled) return 'disabled';
    if (
      command?.status === NodeRuntimeCommandStatus.QUEUED ||
      command?.status === NodeRuntimeCommandStatus.RUNNING
    ) {
      return 'stop_queued';
    }
    if (
      thresholdReached &&
      !subject.active &&
      subject.endpoints.every(
        (endpoint) => endpoint.runtimeState === NodeRuntimeState.INACTIVE,
      )
    ) {
      return 'stopped';
    }
    if (!configured) return 'unavailable';
    return thresholdReached ? 'limit_reached' : 'monitoring';
  }
}
