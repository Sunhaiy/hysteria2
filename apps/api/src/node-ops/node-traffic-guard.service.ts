import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
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

export type NodeTrafficGuardSubject = {
  id: string;
  protocol: NodeProtocol;
  controlApiBaseUrl: string | null;
  controlApiSecret: string | null;
  runtimeState: NodeRuntimeState;
  runtimeStateObservedAt: Date | null;
  trafficLimitEnabled: boolean;
  trafficLimitBytes: bigint | null;
  trafficLimitResetDay: number;
  retiredAt: Date | null;
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

  async project(subjects: NodeTrafficGuardSubject[], now = new Date()) {
    return (await this.collect(subjects, now)).projections;
  }

  async updatePolicy(
    nodeId: string,
    input: UpdateNodeTrafficLimitDto,
    actorId: string,
  ) {
    const existing = await this.prisma.node.findFirst({
      where: { id: nodeId, retiredAt: null },
      select: {
        id: true,
        protocol: true,
        controlApiBaseUrl: true,
        controlApiSecret: true,
      },
    });
    if (!existing) throw new NotFoundException('Node not found');
    if (input.enabled && !this.runtimeControlConfigured(existing)) {
      throw new BadRequestException('请先配置节点服务管理，再启用自动停服');
    }

    const trafficLimitBytes = BigInt(
      Math.round(input.monthlyLimitGiB * Number(bytesPerGiB)),
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const node = await tx.node.update({
        where: { id: nodeId },
        data: {
          trafficLimitEnabled: input.enabled,
          trafficLimitBytes,
          trafficLimitResetDay: input.resetDay,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'node.traffic_limit.updated',
          targetType: 'node',
          targetId: nodeId,
          metadata: {
            enabled: input.enabled,
            monthlyLimitGiB: input.monthlyLimitGiB,
            resetDay: input.resetDay,
          },
        },
      });
      return node;
    });
    return (await this.project([updated])).get(nodeId);
  }

  async enforce(now = new Date()) {
    const subjects = await this.prisma.node.findMany({
      where: {
        retiredAt: null,
        trafficLimitEnabled: true,
        trafficLimitBytes: { not: null },
      },
      select: {
        id: true,
        protocol: true,
        controlApiBaseUrl: true,
        controlApiSecret: true,
        runtimeState: true,
        runtimeStateObservedAt: true,
        trafficLimitEnabled: true,
        trafficLimitBytes: true,
        trafficLimitResetDay: true,
        retiredAt: true,
      },
    });
    const collected = await this.collect(subjects, now);
    let queued = 0;
    let skipped = 0;

    for (const subject of subjects) {
      const projection = collected.projections.get(subject.id);
      if (
        !projection?.configured ||
        !projection.thresholdReached ||
        subject.runtimeState !== NodeRuntimeState.ACTIVE
      ) {
        skipped += 1;
        continue;
      }
      const cycle = this.trafficCycle(now, subject.trafficLimitResetDay);
      const idempotencyKey = this.commandKey(subject, cycle.start, now);
      if (
        projection.status === 'stop_queued' ||
        collected.commandsByKey.has(idempotencyKey)
      ) {
        skipped += 1;
        continue;
      }
      try {
        await this.runtime.requestSystemStop(subject.id, idempotencyKey, {
          cycleStart: cycle.start.toISOString(),
          cycleEnd: cycle.end.toISOString(),
          limitBytes: String(subject.trafficLimitBytes),
          usedBytes: String(collected.usageByNode.get(subject.id) ?? BigInt(0)),
        });
        queued += 1;
      } catch (error) {
        if (error instanceof ConflictException) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
    return { checked: subjects.length, queued, skipped };
  }

  private async collect(subjects: NodeTrafficGuardSubject[], now: Date) {
    const projections = new Map<string, NodeTrafficGuardProjection>();
    const commandsByKey = new Map<string, GuardCommand>();
    const usageByNode = new Map<string, bigint>();
    if (subjects.length === 0) {
      return { projections, commandsByKey, usageByNode };
    }

    const cycles = new Map(
      subjects.map((subject) => [
        subject.id,
        this.trafficCycle(now, subject.trafficLimitResetDay),
      ]),
    );
    const limitedSubjects = subjects.filter(
      (subject) => subject.trafficLimitBytes !== null,
    );
    let commands: GuardCommand[] = [];
    if (limitedSubjects.length > 0) {
      const usageConditions = limitedSubjects.map((subject) => {
        const cycle = cycles.get(subject.id)!;
        return Prisma.sql`(
          rollup."nodeId" = ${subject.id}
          AND rollup."bucketStart" >= ${cycle.start}
          AND rollup."bucketStart" < ${cycle.end}
        )`;
      });
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
        usageByNode.set(row.nodeId, BigInt(row.physicalBytes));
      }

      const commandConditions = limitedSubjects.map((subject) => {
        const cycle = cycles.get(subject.id)!;
        return {
          nodeId: subject.id,
          idempotencyKey: {
            startsWith: this.commandPrefix(subject.id, cycle.start),
          },
        };
      });
      commands = await this.prisma.nodeRuntimeCommand.findMany({
        where: { OR: commandConditions },
        select: { nodeId: true, status: true, idempotencyKey: true },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      });
    }
    const latestCommandByNode = new Map<string, GuardCommand>();
    for (const command of commands) {
      commandsByKey.set(command.idempotencyKey, command);
      if (!latestCommandByNode.has(command.nodeId)) {
        latestCommandByNode.set(command.nodeId, command);
      }
    }

    for (const subject of subjects) {
      const cycle = cycles.get(subject.id)!;
      const limit = subject.trafficLimitBytes;
      const used = usageByNode.get(subject.id) ?? BigInt(0);
      const remaining = limit === null ? null : limit - used;
      const thresholdReached = limit !== null && used >= limit;
      const command = latestCommandByNode.get(subject.id);
      const configured = this.runtimeControlConfigured(subject);
      const status = this.statusFor(
        subject,
        configured,
        thresholdReached,
        command,
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
        status,
      });
    }
    return { projections, commandsByKey, usageByNode };
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

  private commandPrefix(nodeId: string, cycleStart: Date) {
    return `node-traffic-limit:${nodeId}:${cycleStart.toISOString()}:`;
  }

  private commandKey(
    subject: NodeTrafficGuardSubject,
    cycleStart: Date,
    now: Date,
  ) {
    const retryWindow = Math.floor(now.getTime() / 60_000);
    return `${this.commandPrefix(subject.id, cycleStart)}${subject.runtimeStateObservedAt?.getTime() ?? 0}:${retryWindow}`;
  }

  private safeNumber(value: bigint) {
    return Number(
      value > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : value,
    );
  }

  private statusFor(
    subject: NodeTrafficGuardSubject,
    configured: boolean,
    thresholdReached: boolean,
    command?: GuardCommand,
  ): NodeTrafficGuardProjection['status'] {
    if (!subject.trafficLimitEnabled) return 'disabled';
    if (!configured) return 'unavailable';
    if (
      command?.status === NodeRuntimeCommandStatus.QUEUED ||
      command?.status === NodeRuntimeCommandStatus.RUNNING
    ) {
      return 'stop_queued';
    }
    if (
      thresholdReached &&
      subject.runtimeState === NodeRuntimeState.INACTIVE &&
      command?.status === NodeRuntimeCommandStatus.SUCCEEDED
    ) {
      return 'stopped';
    }
    return thresholdReached ? 'limit_reached' : 'monitoring';
  }
}
