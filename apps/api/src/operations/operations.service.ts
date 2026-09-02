import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';
import { NodeControlService } from '../domain/node-control.service';
import { OnlinePresenceService } from '../domain/online-presence.service';
import { NodeAdapterRegistry } from '../integrations/node.adapter';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { KickService } from '../kick-service/kick-service.service';
import {
  type ServerTrafficQuery,
  TrafficAnalyticsService,
  type TrafficQuery,
} from '../traffic-analytics/traffic-analytics.service';

const presenceFreshnessMs = 45_000;
const checkRequestKey = 'operations:check-requested';

export interface PresenceQuery extends PageQuery {
  q?: string;
  nodeId?: string;
  serverId?: string;
  protocol?: 'hysteria2' | 'vless_reality';
}

export interface AlertQuery extends PageQuery {
  status?: string;
  severity?: string;
  nodeId?: string;
}

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);
  private presenceRunning = false;
  private healthRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: NodeAdapterRegistry,
    private readonly monitoring: MonitoringService,
    private readonly traffic: TrafficAnalyticsService,
    private readonly cache: CacheService,
    private readonly kick: KickService,
    private readonly nodes: NodeControlService,
    private readonly presenceProjection: OnlinePresenceService,
  ) {}

  async collectPresence() {
    if (this.presenceRunning) return [];
    this.presenceRunning = true;
    try {
      const nodes = (await this.nodes.getNodesForControl()).filter(
        (node) => node.active && node.lifecycleStatus === 'active',
      );
      return Promise.all(
        nodes.map(async (node) => {
          try {
            const online = await this.adapters.fetchOnline(node);
            const valid = await this.presenceProjection.apply(node.id, online);
            await this.nodes.markPresenceSuccess(node.id);
            return {
              nodeId: node.id,
              onlineAccounts: Object.keys(valid).length,
              onlineClients: Object.values(valid).reduce(
                (sum, clients) => sum + clients,
                0,
              ),
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Presence collection failed for ${node.id}: ${message}`,
            );
            return { nodeId: node.id, error: message };
          }
        }),
      );
    } finally {
      this.presenceRunning = false;
    }
  }

  async probeHealth() {
    if (this.healthRunning) return [];
    this.healthRunning = true;
    try {
      const nodes = (await this.nodes.getNodesForControl()).filter(
        (node) => node.active && node.lifecycleStatus !== 'disabled',
      );
      const results = await Promise.all(
        nodes.map(async (node) => {
          try {
            const checkedAt = new Date();
            const presence = await this.prisma.onlinePresence.aggregate({
              where: {
                nodeId: node.id,
                observedAt: {
                  gte: new Date(checkedAt.getTime() - presenceFreshnessMs),
                },
              },
              _sum: { concurrentClients: true },
              _max: { observedAt: true },
            });
            const probe = await this.adapters.probeHealth(node);
            const healthy =
              probe.agentReachable &&
              probe.coreHealthy !== false &&
              probe.publicEndpointReachable !== false &&
              !node.lastSyncError;
            await this.prisma.nodeHealthSnapshot.create({
              data: {
                nodeId: node.id,
                healthy,
                agentReachable: probe.agentReachable,
                coreHealthy: probe.coreHealthy,
                publicEndpointReachable: probe.publicEndpointReachable,
                latencyMs: probe.latencyMs,
                onlineUsers: presence._sum.concurrentClients ?? 0,
                userSyncAt: node.lastUserSyncAt
                  ? new Date(node.lastUserSyncAt)
                  : node.lastSyncAt
                    ? new Date(node.lastSyncAt)
                    : null,
                trafficAt: node.lastTrafficAt
                  ? new Date(node.lastTrafficAt)
                  : node.lastSyncAt
                    ? new Date(node.lastSyncAt)
                    : null,
                presenceAt: node.lastPresenceAt
                  ? new Date(node.lastPresenceAt)
                  : presence._max.observedAt,
                error: probe.error ?? node.lastSyncError,
                checkedAt,
              },
            });
            return { nodeId: node.id, healthy, ...probe };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(`Health probe failed for ${node.id}: ${message}`);
            return { nodeId: node.id, healthy: false, error: message };
          }
        }),
      );
      await this.monitoring.runChecks();
      await this.prisma.nodeHealthSnapshot.deleteMany({
        where: {
          checkedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      });
      return results;
    } finally {
      this.healthRunning = false;
    }
  }

  async requestCheck() {
    await this.cache.set(checkRequestKey, new Date().toISOString(), 120);
    return { accepted: true };
  }

  async consumeRequestedCheck() {
    const requested = await this.cache.get(checkRequestKey);
    if (!requested) return false;
    await this.cache.del(checkRequestKey);
    await this.collectPresence();
    await this.probeHealth();
    return true;
  }

  async summary() {
    const freshSince = new Date(Date.now() - presenceFreshnessMs);
    const [nodes, online, alerts] = await Promise.all([
      this.prisma.node.findMany({
        where: { retiredAt: null },
        include: {
          server: true,
          healthSnapshots: { orderBy: { checkedAt: 'desc' }, take: 1 },
        },
        orderBy: [{ serverId: 'asc' }, { protocol: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.onlinePresence.aggregate({
        where: {
          observedAt: { gte: freshSince },
          concurrentClients: { gt: 0 },
        },
        _sum: { concurrentClients: true },
        _count: { _all: true },
      }),
      this.prisma.monitorAlert.groupBy({
        by: ['status', 'severity'],
        _count: { _all: true },
      }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      freshnessSeconds: presenceFreshnessMs / 1000,
      onlineAccounts: online._count._all,
      onlineClients: online._sum.concurrentClients ?? 0,
      openAlerts: alerts
        .filter((alert) => alert.status !== 'RESOLVED')
        .reduce((sum, alert) => sum + alert._count._all, 0),
      criticalAlerts: alerts
        .filter(
          (alert) =>
            alert.status !== 'RESOLVED' && alert.severity === 'CRITICAL',
        )
        .reduce((sum, alert) => sum + alert._count._all, 0),
      nodes: nodes.map((node) => {
        const health = node.healthSnapshots[0];
        return {
          id: node.id,
          serverId: node.serverId,
          serverName: node.server?.name ?? node.hostname,
          label: node.label,
          protocol: node.protocol.toLowerCase(),
          lifecycleStatus: node.lifecycleStatus.toLowerCase(),
          healthy: health?.healthy ?? null,
          latencyMs: health?.latencyMs ?? null,
          onlineUsers: health?.onlineUsers ?? 0,
          checkedAt: health?.checkedAt.toISOString() ?? null,
          error: health?.error ?? node.lastSyncError,
        };
      }),
    };
  }

  async presence(query: PresenceQuery) {
    const { page, pageSize, skip } = parsePage(query);
    const q = query.q?.trim();
    const protocol = query.protocol?.toUpperCase();
    const where: Prisma.OnlinePresenceWhereInput = {
      observedAt: { gte: new Date(Date.now() - presenceFreshnessMs) },
      concurrentClients: { gt: 0 },
      user: q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      node: {
        id: query.nodeId,
        serverId: query.serverId,
        protocol: protocol as never,
      },
    };
    const [items, total] = await Promise.all([
      this.prisma.onlinePresence.findMany({
        where,
        include: { user: true, node: { include: { server: true } } },
        orderBy: [
          { concurrentClients: 'desc' },
          { observedAt: 'desc' },
          { id: 'desc' },
        ],
        skip,
        take: pageSize,
      }),
      this.prisma.onlinePresence.count({ where }),
    ]);
    return pageResponse(
      items.map((item) => ({
        id: item.id,
        userId: item.userId,
        userEmail: item.user.email,
        userDisplayName: item.user.displayName,
        nodeId: item.nodeId,
        nodeLabel: item.node.label,
        serverId: item.node.serverId,
        serverName: item.node.server?.name ?? item.node.hostname,
        protocol: item.node.protocol.toLowerCase(),
        concurrentClients: item.concurrentClients,
        observedAt: item.observedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  trafficOverview(query: TrafficQuery) {
    return this.traffic.overview(query);
  }

  trafficDetails(query: TrafficQuery) {
    return this.traffic.details(query);
  }

  serverTraffic(query: ServerTrafficQuery) {
    return this.traffic.serverMonthly(query);
  }

  async alerts(query: AlertQuery) {
    const { page, pageSize, skip } = parsePage(query);
    const where: Prisma.MonitorAlertWhereInput = {
      status: query.status ? (query.status.toUpperCase() as never) : undefined,
      severity: query.severity
        ? (query.severity.toUpperCase() as never)
        : undefined,
      nodeId: query.nodeId,
    };
    const [items, total] = await Promise.all([
      this.prisma.monitorAlert.findMany({
        where,
        include: {
          node: { select: { label: true } },
          acknowledgedBy: { select: { email: true } },
          events: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
        orderBy: [
          { status: 'asc' },
          { severity: 'desc' },
          { lastSeenAt: 'desc' },
          { id: 'desc' },
        ],
        skip,
        take: pageSize,
      }),
      this.prisma.monitorAlert.count({ where }),
    ]);
    return pageResponse(
      items.map((alert) => ({
        id: alert.id,
        fingerprint: alert.fingerprint,
        kind: alert.kind,
        severity: alert.severity.toLowerCase(),
        status: alert.status.toLowerCase(),
        title: alert.title,
        message: alert.message,
        nodeLabel: alert.node?.label ?? null,
        failureCount: alert.failureCount,
        successCount: alert.successCount,
        firstSeenAt: alert.firstSeenAt.toISOString(),
        lastSeenAt: alert.lastSeenAt.toISOString(),
        acknowledgedByEmail: alert.acknowledgedBy?.email ?? null,
        acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: alert.resolvedAt?.toISOString() ?? null,
        events: alert.events.map((event) => ({
          id: event.id,
          status: event.status.toLowerCase(),
          message: event.message,
          createdAt: event.createdAt.toISOString(),
        })),
      })),
      total,
      page,
      pageSize,
    );
  }

  kickUser(userId: string, actorEmail: string) {
    return this.kick.kickUserEverywhere(userId, `operations:${actorEmail}`);
  }

  acknowledgeAlert(id: string, actorId: string) {
    return this.monitoring.acknowledge(id, actorId);
  }
}
