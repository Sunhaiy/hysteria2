import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AdminPermission,
  DestinationTargetType,
  DestinationTransport,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NodeControlService } from '../domain/node-control.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DestinationBatchDto,
  UpdateAdminPermissionsDto,
} from './destination-telemetry.dto';

interface DestinationQuery {
  q?: string;
  userId?: string;
  nodeId?: string;
  transport?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
}

@Injectable()
export class DestinationTelemetryService {
  private readonly logger = new Logger(DestinationTelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly nodes: NodeControlService,
  ) {}

  async ingest(
    nodeId: string,
    authorization: string | undefined,
    input: DestinationBatchDto,
  ) {
    const node = await this.nodes.getNodeForControl(nodeId);
    if (!node) throw new NotFoundException('Node not found');
    if (!this.secretMatches(authorization, node.trafficApiSecret)) {
      throw new UnauthorizedException('Invalid node secret');
    }
    if (!input.externalId.trim()) {
      throw new BadRequestException('externalId is required');
    }
    const observedAt = new Date(input.observedAt);
    const normalized = input.visits.map((visit, index) => {
      const target = this.normalizeTarget(visit.target);
      const firstSeenAt = new Date(visit.firstSeenAt);
      const lastSeenAt = new Date(visit.lastSeenAt);
      if (lastSeenAt < firstSeenAt) {
        throw new BadRequestException(
          'lastSeenAt must not precede firstSeenAt',
        );
      }
      const bucketStart = new Date(firstSeenAt);
      bucketStart.setUTCSeconds(0, 0);
      return {
        index,
        userId: visit.userId,
        target: target.value,
        targetType: target.type,
        port: visit.port,
        transport:
          visit.transport === 'tcp'
            ? DestinationTransport.TCP
            : DestinationTransport.UDP,
        connectionCount: visit.connectionCount,
        firstSeenAt,
        lastSeenAt,
        bucketStart,
      };
    });

    const knownUsers = await this.prisma.user.count({
      where: {
        id: { in: [...new Set(normalized.map((item) => item.userId))] },
      },
    });
    if (knownUsers !== new Set(normalized.map((item) => item.userId)).size) {
      throw new BadRequestException('Batch contains an unknown user');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.destinationImportBatch.findUnique({
        where: { nodeId_externalId: { nodeId, externalId: input.externalId } },
      });
      if (existing) return { replayed: true, batchId: existing.id };
      const batch = await tx.destinationImportBatch.create({
        data: {
          nodeId,
          externalId: input.externalId,
          observedAt,
          eventCount: normalized.reduce(
            (sum, item) => sum + item.connectionCount,
            0,
          ),
        },
      });
      if (normalized.length > 0) {
        await tx.destinationVisitRollup.createMany({
          data: normalized.map((visit) => ({
            dedupeKey: this.dedupeKey(nodeId, input.externalId, visit.index),
            batchId: batch.id,
            nodeId,
            userId: visit.userId,
            bucketStart: visit.bucketStart,
            target: visit.target,
            targetType: visit.targetType,
            port: visit.port,
            transport: visit.transport,
            connectionCount: visit.connectionCount,
            firstSeenAt: visit.firstSeenAt,
            lastSeenAt: visit.lastSeenAt,
          })),
        });
      }
      await tx.node.update({
        where: { id: nodeId },
        data: {
          destinationTelemetryEnabled: true,
          destinationTelemetryVersion: input.agentVersion,
          destinationTelemetryLastAt: new Date(),
          destinationTelemetryError: null,
        },
      });
      return { replayed: false, batchId: batch.id };
    });
    return { ...result, accepted: normalized.length };
  }

  async status() {
    const nodes = await this.prisma.node.findMany({
      where: { active: true },
      select: {
        id: true,
        label: true,
        protocol: true,
        destinationTelemetryEnabled: true,
        destinationTelemetryVersion: true,
        destinationTelemetryLastAt: true,
        destinationTelemetryError: true,
      },
      orderBy: { label: 'asc' },
    });
    const staleBefore = Date.now() - 120_000;
    const presented = nodes.map((node) => ({
      id: node.id,
      label: node.label,
      protocol: node.protocol.toLowerCase(),
      enabled: node.destinationTelemetryEnabled,
      version: node.destinationTelemetryVersion,
      lastAt: node.destinationTelemetryLastAt?.toISOString() ?? null,
      error: node.destinationTelemetryError,
      ready:
        node.destinationTelemetryEnabled &&
        Boolean(node.destinationTelemetryVersion) &&
        Boolean(
          node.destinationTelemetryLastAt &&
          node.destinationTelemetryLastAt.getTime() >= staleBefore,
        ),
    }));
    return {
      enabled: presented.length > 0 && presented.every((node) => node.ready),
      nodes: presented,
    };
  }

  async query(query: DestinationQuery, actorId: string) {
    const status = await this.status();
    const where: Prisma.DestinationVisitRollupWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.nodeId) where.nodeId = query.nodeId;
    if (query.transport) {
      where.transport = query.transport.toUpperCase() as DestinationTransport;
    }
    if (query.q?.trim()) {
      where.target = { contains: query.q.trim(), mode: 'insensitive' };
    }
    const bucketStart: Prisma.DateTimeFilter = {};
    const from = this.validDate(query.from);
    const to = this.validDate(query.to);
    if (from) bucketStart.gte = from;
    if (to) bucketStart.lte = to;
    if (from || to) where.bucketStart = bucketStart;
    const parsed = Number.parseInt(query.limit ?? '50', 10);
    const limit = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 200)
      : 50;
    const [items, total] = status.enabled
      ? await Promise.all([
          this.prisma.destinationVisitRollup.findMany({
            where,
            include: {
              user: { select: { email: true, displayName: true } },
              node: { select: { label: true, protocol: true } },
            },
            orderBy: [{ bucketStart: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          }),
          this.prisma.destinationVisitRollup.count({ where }),
        ])
      : [[], 0];
    const hasMore = items.length > limit;
    const pageItems = items.slice(0, limit);
    await this.audit.record({
      actorId,
      action: 'destination_audit.queried',
      targetType: 'destination_visit',
      metadata: {
        userId: query.userId ?? null,
        nodeId: query.nodeId ?? null,
        target: query.q ?? null,
        resultCount: pageItems.length,
        telemetryEnabled: status.enabled,
      },
    });
    return {
      enabled: status.enabled,
      status,
      items: pageItems.map((item) => ({
        id: item.id,
        userId: item.userId,
        userEmail: item.user.email,
        userDisplayName: item.user.displayName,
        nodeId: item.nodeId,
        nodeLabel: item.node.label,
        protocol: item.node.protocol.toLowerCase(),
        bucketStart: item.bucketStart.toISOString(),
        target: item.target,
        targetType: item.targetType.toLowerCase(),
        port: item.port,
        transport: item.transport.toLowerCase(),
        connectionCount: item.connectionCount,
        firstSeenAt: item.firstSeenAt.toISOString(),
        lastSeenAt: item.lastSeenAt.toISOString(),
      })),
      nextCursor: hasMore ? (pageItems.at(-1)?.id ?? null) : null,
      total,
    };
  }

  async listAdminPermissions() {
    const users = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      include: { adminPermissions: true },
      orderBy: { email: 'asc' },
    });
    return users.map((user) => ({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      permissions: user.adminPermissions.map((grant) =>
        this.fromPermission(grant.permission),
      ),
    }));
  }

  async updateAdminPermissions(
    userId: string,
    input: UpdateAdminPermissionsDto,
    actorId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'ADMIN') {
      throw new BadRequestException('Target user is not an administrator');
    }
    const permissions = input.permissions.map((value) =>
      this.toPermission(value),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.adminPermissionGrant.deleteMany({ where: { userId } });
      if (permissions.length > 0) {
        await tx.adminPermissionGrant.createMany({
          data: permissions.map((permission) => ({ userId, permission })),
        });
      }
      await tx.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'admin.permissions.updated',
          targetType: 'user',
          targetId: userId,
          metadata: { permissions: input.permissions },
        },
      });
    });
    return { userId, permissions: input.permissions };
  }

  @Cron('0 20 3 * * *')
  async cleanupExpiredTelemetry() {
    const retentionDays = Number.parseInt(
      process.env.DESTINATION_RETENTION_DAYS ?? '30',
      10,
    );
    const cutoff = new Date(
      Date.now() - Math.max(retentionDays, 1) * 24 * 60 * 60 * 1000,
    );
    const deleted = await this.prisma.destinationImportBatch.deleteMany({
      where: { observedAt: { lt: cutoff } },
    });
    if (deleted.count > 0) {
      this.logger.log(`Deleted ${deleted.count} destination telemetry batches`);
    }
  }

  private normalizeTarget(raw: string) {
    const trimmed = raw
      .trim()
      .replace(/^\[|\]$/g, '')
      .toLowerCase();
    if (!trimmed || trimmed.includes('/') || trimmed.includes('://')) {
      throw new BadRequestException('Target must be a domain or IP address');
    }
    if (isIP(trimmed)) {
      return { value: trimmed, type: DestinationTargetType.IP };
    }
    const ascii = domainToASCII(trimmed).replace(/\.$/, '');
    if (!ascii || ascii.length > 253 || !ascii.includes('.')) {
      throw new BadRequestException('Invalid destination domain');
    }
    return { value: ascii, type: DestinationTargetType.DOMAIN };
  }

  private secretMatches(provided: string | undefined, expected: string) {
    if (!provided) return false;
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private dedupeKey(nodeId: string, externalId: string, index: number) {
    return createHash('sha256')
      .update(`${nodeId}:${externalId}:${index}`)
      .digest('hex');
  }

  private validDate(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toPermission(
    value: UpdateAdminPermissionsDto['permissions'][number],
  ) {
    return value === 'destination_audit.read'
      ? AdminPermission.DESTINATION_AUDIT_READ
      : AdminPermission.ADMIN_PERMISSIONS_MANAGE;
  }

  private fromPermission(value: AdminPermission) {
    return value === AdminPermission.DESTINATION_AUDIT_READ
      ? 'destination_audit.read'
      : 'admin_permissions.manage';
  }
}
