import { Injectable, Logger } from '@nestjs/common';
import {
  MonitorAlertSeverity,
  MonitorAlertStatus,
  NodeLifecycleStatus,
  Prisma,
  UsageImportBatchStatus,
} from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

interface CheckResult {
  fingerprint: string;
  kind: string;
  severity: MonitorAlertSeverity;
  title: string;
  message: string;
  failing: boolean;
  nodeId?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async scheduledCheck() {
    try {
      await this.runChecks();
    } catch (error) {
      this.logger.error('Monitoring check failed', error);
    }
  }

  async runChecks(now = new Date()) {
    const [nodes, pendingBatches, deniedAuth] = await Promise.all([
      this.prisma.node.findMany({
        where: { retiredAt: null },
        include: {
          serviceChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
          healthSnapshots: { orderBy: { checkedAt: 'desc' }, take: 1 },
          onlinePresence: {
            where: { observedAt: { gte: new Date(now.getTime() - 45_000) } },
          },
        },
      }),
      this.prisma.usageImportBatch.count({
        where: { status: UsageImportBatchStatus.APPLIED },
      }),
      this.prisma.authEvent.count({
        where: {
          granted: false,
          createdAt: { gte: new Date(now.getTime() - 5 * 60_000) },
        },
      }),
    ]);
    const results: CheckResult[] = [];
    for (const node of nodes) {
      const syncDelaySeconds = node.lastSyncAt
        ? Math.max(
            0,
            Math.floor((now.getTime() - node.lastSyncAt.getTime()) / 1000),
          )
        : null;
      const managed =
        node.active && node.lifecycleStatus !== NodeLifecycleStatus.DISABLED;
      const health = node.healthSnapshots[0];
      const healthStale =
        !health || now.getTime() - health.checkedAt.getTime() > 180_000;
      const offline =
        managed &&
        (healthStale ||
          !health.agentReachable ||
          health.coreHealthy === false ||
          health.publicEndpointReachable === false);
      const syncTimeout =
        managed && Boolean(node.lastSyncError || (syncDelaySeconds ?? 0) > 120);
      const onlineUsers = node.onlinePresence.reduce(
        (total, snapshot) => total + snapshot.concurrentClients,
        0,
      );
      await this.prisma.nodeServiceCheck.create({
        data: {
          nodeId: node.id,
          healthy: !offline && !node.lastSyncError,
          latencyMs: health?.latencyMs,
          onlineUsers,
          syncDelaySeconds,
          error: health?.error ?? node.lastSyncError,
          checkedAt: now,
        },
      });
      results.push(
        {
          fingerprint: `node-offline:${node.id}`,
          kind: 'NODE_OFFLINE',
          severity: MonitorAlertSeverity.CRITICAL,
          title: `${node.label} 节点失联`,
          message: '节点超过 180 秒没有可用同步信号。',
          failing: offline,
          nodeId: node.id,
          metadata: { syncDelaySeconds },
        },
        {
          fingerprint: `node-sync-timeout:${node.id}`,
          kind: 'NODE_SYNC_TIMEOUT',
          severity: MonitorAlertSeverity.CRITICAL,
          title: `${node.label} 同步超时`,
          message: node.lastSyncError ?? '节点同步延迟超过 120 秒。',
          failing: syncTimeout,
          nodeId: node.id,
          metadata: { syncDelaySeconds },
        },
        {
          fingerprint: `node-presence-stale:${node.id}`,
          kind: 'NODE_PRESENCE_STALE',
          severity: MonitorAlertSeverity.WARNING,
          title: `${node.label} 在线采集过期`,
          message: '在线状态超过 45 秒没有更新。',
          failing:
            managed &&
            (!health?.presenceAt ||
              now.getTime() - health.presenceAt.getTime() > 45_000),
          nodeId: node.id,
        },
        {
          fingerprint: `node-user-sync-stale:${node.id}`,
          kind: 'NODE_USER_SYNC_STALE',
          severity: MonitorAlertSeverity.WARNING,
          title: `${node.label} 用户同步过期`,
          message: '授权用户同步超过 120 秒没有成功。',
          failing:
            managed &&
            (!health?.userSyncAt ||
              now.getTime() - health.userSyncAt.getTime() > 120_000),
          nodeId: node.id,
        },
        {
          fingerprint: `node-traffic-stale:${node.id}`,
          kind: 'NODE_TRAFFIC_STALE',
          severity: MonitorAlertSeverity.CRITICAL,
          title: `${node.label} 流量采集过期`,
          message: '流量批次超过 120 秒没有成功确认。',
          failing:
            managed &&
            (!health?.trafficAt ||
              now.getTime() - health.trafficAt.getTime() > 120_000),
          nodeId: node.id,
        },
      );
      if (node.capacityUsers) {
        const capacityPercent = (onlineUsers / node.capacityUsers) * 100;
        results.push({
          fingerprint: `node-capacity:${node.id}`,
          kind: 'NODE_CAPACITY_HIGH',
          severity:
            capacityPercent >= 95
              ? MonitorAlertSeverity.CRITICAL
              : MonitorAlertSeverity.WARNING,
          title: `${node.label} 容量偏高`,
          message: `当前连接数达到配置容量的 ${capacityPercent.toFixed(1)}%。`,
          failing: capacityPercent >= 80,
          nodeId: node.id,
          metadata: { onlineUsers, capacityUsers: node.capacityUsers },
        });
      }
      if (node.destinationTelemetryEnabled) {
        const stale =
          !node.destinationTelemetryLastAt ||
          now.getTime() - node.destinationTelemetryLastAt.getTime() > 180_000;
        results.push({
          fingerprint: `telemetry-stale:${node.id}`,
          kind: 'TELEMETRY_STALE',
          severity: MonitorAlertSeverity.WARNING,
          title: `${node.label} 遥测过期`,
          message: '目的地遥测超过 180 秒没有更新。',
          failing: stale,
          nodeId: node.id,
        });
      }
    }
    results.push(
      {
        fingerprint: 'usage-batch-backlog:global',
        kind: 'USAGE_BATCH_BACKLOG',
        severity: MonitorAlertSeverity.WARNING,
        title: '流量批次积压',
        message: `当前有 ${pendingBatches} 个批次等待确认。`,
        failing: pendingBatches >= 100,
        metadata: { pendingBatches },
      },
      {
        fingerprint: 'auth-rejection-anomaly:global',
        kind: 'AUTH_REJECTION_ANOMALY',
        severity: MonitorAlertSeverity.CRITICAL,
        title: '鉴权拒绝异常',
        message: `最近 5 分钟出现 ${deniedAuth} 次鉴权拒绝。`,
        failing: deniedAuth >= 20,
        metadata: { deniedAuth, windowMinutes: 5 },
      },
    );
    for (const result of results) await this.applyResult(result, now);
    await this.retryPendingNotifications();
    await this.prisma.nodeServiceCheck.deleteMany({
      where: {
        checkedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    return { checkedAt: now.toISOString(), checks: results.length };
  }

  async overview() {
    const [alerts, nodes, activeServers] = await Promise.all([
      this.prisma.monitorAlert.findMany({
        include: {
          node: true,
          acknowledgedBy: true,
          events: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
        orderBy: [
          { status: 'asc' },
          { severity: 'desc' },
          { lastSeenAt: 'desc' },
        ],
      }),
      this.prisma.node.findMany({
        where: { retiredAt: null },
        include: { serviceChecks: { orderBy: { checkedAt: 'desc' }, take: 1 } },
      }),
      this.prisma.nodeServer.count({
        where: { active: true, retiredAt: null },
      }),
    ]);
    return {
      checkIntervalSeconds: 60,
      open: alerts.filter((alert) => alert.status === MonitorAlertStatus.OPEN)
        .length,
      acknowledged: alerts.filter(
        (alert) => alert.status === MonitorAlertStatus.ACKNOWLEDGED,
      ).length,
      critical: alerts.filter(
        (alert) =>
          alert.status !== MonitorAlertStatus.RESOLVED &&
          alert.severity === MonitorAlertSeverity.CRITICAL,
      ).length,
      activeServers,
      activePools: activeServers,
      nodes: nodes.map((node) => ({
        id: node.id,
        label: node.label,
        lifecycleStatus: node.lifecycleStatus.toLowerCase(),
        healthy: node.serviceChecks[0]?.healthy ?? null,
        onlineUsers: node.serviceChecks[0]?.onlineUsers ?? 0,
        syncDelaySeconds: node.serviceChecks[0]?.syncDelaySeconds ?? null,
        checkedAt: node.serviceChecks[0]?.checkedAt.toISOString() ?? null,
      })),
      alerts: alerts.map((alert) => ({
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
    };
  }

  async acknowledge(id: string, actorId: string) {
    const alert = await this.prisma.monitorAlert.update({
      where: { id },
      data: {
        status: MonitorAlertStatus.ACKNOWLEDGED,
        acknowledgedById: actorId,
        acknowledgedAt: new Date(),
        events: {
          create: {
            status: MonitorAlertStatus.ACKNOWLEDGED,
            message: '管理员已确认告警。',
          },
        },
      },
    });
    return { id: alert.id, status: 'acknowledged' };
  }

  private async applyResult(result: CheckResult, now: Date) {
    const existing = await this.prisma.monitorAlert.findUnique({
      where: { fingerprint: result.fingerprint },
    });
    if (result.failing) {
      const nextFailure = (existing?.failureCount ?? 0) + 1;
      const opening =
        nextFailure >= 2 &&
        (!existing || existing.status === MonitorAlertStatus.RESOLVED);
      const status = opening
        ? MonitorAlertStatus.OPEN
        : (existing?.status ?? MonitorAlertStatus.RESOLVED);
      const alert = await this.prisma.monitorAlert.upsert({
        where: { fingerprint: result.fingerprint },
        create: {
          fingerprint: result.fingerprint,
          kind: result.kind,
          severity: result.severity,
          status,
          title: result.title,
          message: result.message,
          nodeId: result.nodeId,
          failureCount: nextFailure,
          lastSeenAt: now,
          resolvedAt: status === MonitorAlertStatus.RESOLVED ? now : null,
          metadata: result.metadata,
          events: opening
            ? {
                create: {
                  status: MonitorAlertStatus.OPEN,
                  message: '连续两次检测失败，告警开启。',
                },
              }
            : undefined,
        },
        update: {
          kind: result.kind,
          severity: result.severity,
          status,
          title: result.title,
          message: result.message,
          nodeId: result.nodeId,
          failureCount: nextFailure,
          successCount: 0,
          lastSeenAt: now,
          resolvedAt: opening ? null : undefined,
          metadata: result.metadata,
          events: opening
            ? {
                create: {
                  status: MonitorAlertStatus.OPEN,
                  message: '连续两次检测失败，告警开启。',
                },
              }
            : undefined,
        },
      });
      if (opening && alert.severity === MonitorAlertSeverity.CRITICAL) {
        await this.notify(alert, 'opened');
      }
      return;
    }
    if (!existing) return;
    if (existing.status === MonitorAlertStatus.RESOLVED) {
      await this.prisma.monitorAlert.update({
        where: { id: existing.id },
        data: { failureCount: 0, successCount: 0 },
      });
      return;
    }
    const nextSuccess = existing.successCount + 1;
    const resolving = nextSuccess >= 2;
    const alert = await this.prisma.monitorAlert.update({
      where: { id: existing.id },
      data: {
        successCount: nextSuccess,
        failureCount: 0,
        status: resolving ? MonitorAlertStatus.RESOLVED : existing.status,
        resolvedAt: resolving ? now : undefined,
        events: resolving
          ? {
              create: {
                status: MonitorAlertStatus.RESOLVED,
                message: '连续两次检测恢复，告警关闭。',
              },
            }
          : undefined,
      },
    });
    if (resolving && alert.severity === MonitorAlertSeverity.CRITICAL) {
      await this.notify(alert, 'resolved');
    }
  }

  private async notify(
    alert: {
      id: string;
      title: string;
      message: string;
      metadata: Prisma.JsonValue;
    },
    state: 'opened' | 'resolved',
  ) {
    try {
      const admin = await this.prisma.user.findFirst({
        where: { role: 'ADMIN', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      });
      if (!admin) return;
      await this.mail.sendOperationalAlert({
        to: admin.email,
        title: alert.title,
        message: alert.message,
        state,
      });
      await this.prisma.monitorAlert.update({
        where: { id: alert.id },
        data: { metadata: { notificationPending: null } },
      });
    } catch (error) {
      this.logger.warn(`Alert email failed for ${alert.id}: ${String(error)}`);
      await this.prisma.monitorAlert.update({
        where: { id: alert.id },
        data: { metadata: { notificationPending: state } },
      });
    }
  }

  private async retryPendingNotifications() {
    const alerts = await this.prisma.monitorAlert.findMany();
    for (const alert of alerts) {
      const metadata = alert.metadata;
      if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object')
        continue;
      const pending = metadata.notificationPending;
      if (pending === 'opened' || pending === 'resolved') {
        await this.notify(alert, pending);
      }
    }
  }
}
