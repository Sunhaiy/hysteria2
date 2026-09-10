import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESENCE_FRESHNESS_MS = 45_000;
const DASHBOARD_CACHE_KEY = 'admin:dashboard:summary:v2';
const DASHBOARD_FRESHNESS_MS = 90_000;
const DASHBOARD_CACHE_TTL_SECONDS = 10 * 60;

interface UsageAggregateRow {
  date: string;
  nodeId: string;
  txBytes: bigint;
  rxBytes: bigint;
  physicalBytes: bigint;
  lastSeenAt: Date | null;
}

interface OnlineRow {
  users: bigint;
  connections: bigint;
}

interface CountRow {
  count: bigint;
}

interface NodeRow {
  id: string;
  label: string;
  serverName: string;
  protocol: string;
  active: boolean;
  healthy: boolean | null;
  onlineUsers: bigint;
  activeConnections: bigint;
}

interface StatusRow {
  status: string;
  count: bigint;
}

interface AuthRow {
  granted: boolean;
  count: bigint;
}

export interface DashboardSummary {
  generatedAt: string;
  timezone: string;
  freshnessSeconds: number;
  metrics: {
    todayPhysicalBytes: number;
    yesterdayPhysicalBytes: number;
    monthPhysicalBytes: number;
    activePlanSubscribers: number;
    onlineUsers: number;
    activeConnections: number;
  };
  trend: Array<{
    date: string;
    txBytes: number;
    rxBytes: number;
    physicalBytes: number;
  }>;
  nodes: Array<{
    id: string;
    label: string;
    serverName: string;
    protocol: string;
    active: boolean;
    healthy: boolean | null;
    physicalBytes: number;
    onlineUsers: number;
    activeConnections: number;
    lastSeenAt: string | null;
  }>;
  subscriptions: {
    active: number;
    expired: number;
    paused: number;
    canceled: number;
  };
  auth: { granted: number; denied: number };
}

@Injectable()
export class DashboardService implements OnModuleInit {
  private readonly logger = new Logger(DashboardService.name);
  private inFlightSummary: Promise<DashboardSummary> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  onModuleInit() {
    void this.summary().catch((error) => {
      this.logger.warn(
        `Dashboard cache warm-up failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async summary(now = new Date()): Promise<DashboardSummary> {
    const cached = await this.readCachedSummary();
    if (cached) {
      const age = now.getTime() - new Date(cached.generatedAt).getTime();
      if (Number.isFinite(age) && age <= DASHBOARD_FRESHNESS_MS) {
        return cached;
      }
      void this.refreshSummary(now).catch((error) => {
        this.logger.warn(
          `Dashboard background refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return cached;
    }
    return this.refreshSummary(now);
  }

  private async readCachedSummary() {
    if (!this.cache) return null;
    try {
      const raw = await this.cache.get(DASHBOARD_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DashboardSummary;
      return typeof parsed.generatedAt === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  private refreshSummary(now: Date) {
    if (this.inFlightSummary) return this.inFlightSummary;
    const request = this.querySummary(now)
      .then(async (result) => {
        try {
          await this.cache?.set(
            DASHBOARD_CACHE_KEY,
            JSON.stringify(result),
            DASHBOARD_CACHE_TTL_SECONDS,
          );
        } catch (error) {
          this.logger.warn(
            `Dashboard cache write failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return result;
      })
      .finally(() => {
        if (this.inFlightSummary === request) this.inFlightSummary = null;
      });
    this.inFlightSummary = request;
    return request;
  }

  private async querySummary(now: Date): Promise<DashboardSummary> {
    const todayKey = this.shanghaiDateKey(now);
    const yesterdayKey = this.shiftDateKey(todayKey, -1);
    const todayStart = this.startOfShanghaiDate(todayKey);
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const monthKey = `${todayKey.slice(0, 7)}-01`;
    const monthStart = this.startOfShanghaiDate(monthKey);
    const trendStart = new Date(todayStart.getTime() - 13 * DAY_MS);
    const usageStart = new Date(
      Math.min(
        monthStart.getTime(),
        trendStart.getTime(),
        yesterdayStart.getTime(),
      ),
    );
    const freshSince = new Date(now.getTime() - PRESENCE_FRESHNESS_MS);

    const [
      usageRows,
      subscriberRows,
      onlineRows,
      nodeRows,
      subscriptionRows,
      authRows,
    ] = await Promise.all([
      this.prisma.$queryRaw<UsageAggregateRow[]>(Prisma.sql`
        SELECT
          to_char(
            r."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai',
            'YYYY-MM-DD'
          ) AS "date",
          r."nodeId" AS "nodeId",
          COALESCE(SUM(r."txBytes"), 0)::bigint AS "txBytes",
          COALESCE(SUM(r."rxBytes"), 0)::bigint AS "rxBytes",
          COALESCE(SUM(COALESCE(r."rawBytes", r."txBytes" + r."rxBytes")), 0)::bigint AS "physicalBytes",
          MAX(r."bucketStart") AS "lastSeenAt"
        FROM "UsageRollup" r
        WHERE r."bucketStart" >= ${usageStart}
          AND r."bucketStart" < ${tomorrowStart}
        GROUP BY 1, 2
        ORDER BY 1 ASC, 2 ASC
      `),
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(DISTINCT grant_record."userId")::bigint AS "count"
        FROM "EntitlementGrant" grant_record
        WHERE grant_record."kind" = 'PLAN'
          AND grant_record."status" = 'ACTIVE'
          AND grant_record."startsAt" <= ${now}
          AND grant_record."endsAt" > ${now}
      `),
      this.prisma.$queryRaw<OnlineRow[]>(Prisma.sql`
        SELECT
          COUNT(DISTINCT presence."userId")::bigint AS "users",
          COALESCE(SUM(presence."concurrentClients"), 0)::bigint AS "connections"
        FROM "OnlinePresence" presence
        WHERE presence."observedAt" >= ${freshSince}
          AND presence."concurrentClients" > 0
      `),
      this.prisma.$queryRaw<NodeRow[]>(Prisma.sql`
        WITH node_presence AS (
          SELECT presence."nodeId",
            COUNT(DISTINCT presence."userId")::bigint AS users,
            COALESCE(SUM(presence."concurrentClients"), 0)::bigint AS connections
          FROM "OnlinePresence" presence
          WHERE presence."observedAt" >= ${freshSince}
            AND presence."concurrentClients" > 0
          GROUP BY presence."nodeId"
        )
        SELECT node.id, node.label,
          COALESCE(server.name, node.hostname) AS "serverName",
          node.protocol::text AS protocol,
          node.active,
          health.healthy,
          COALESCE(presence.users, 0)::bigint AS "onlineUsers",
          COALESCE(presence.connections, 0)::bigint AS "activeConnections"
        FROM "Node" node
        LEFT JOIN "NodeServer" server ON server.id = node."serverId"
        LEFT JOIN LATERAL (
          SELECT snapshot.healthy
          FROM "NodeHealthSnapshot" snapshot
          WHERE snapshot."nodeId" = node.id
          ORDER BY snapshot."checkedAt" DESC
          LIMIT 1
        ) health ON TRUE
        LEFT JOIN node_presence presence ON presence."nodeId" = node.id
        ORDER BY node.label ASC
      `),
      this.prisma.$queryRaw<StatusRow[]>(Prisma.sql`
        SELECT subscription.status::text AS status, COUNT(*)::bigint AS count
        FROM "Subscription" subscription
        GROUP BY subscription.status
      `),
      this.prisma.$queryRaw<AuthRow[]>(Prisma.sql`
        SELECT event.granted, COUNT(*)::bigint AS count
        FROM "AuthEvent" event
        WHERE event."createdAt" >= ${new Date(now.getTime() - DAY_MS)}
        GROUP BY event.granted
      `),
    ]);

    const online = onlineRows[0] ?? { users: 0n, connections: 0n };
    const traffic = { todayBytes: 0, yesterdayBytes: 0, monthBytes: 0 };
    const trendByDate = new Map<
      string,
      { txBytes: number; rxBytes: number; physicalBytes: number }
    >();
    const nodeTraffic = new Map<
      string,
      { physicalBytes: number; lastSeenAt: Date | null }
    >();
    for (const row of usageRows) {
      const txBytes = Number(row.txBytes);
      const rxBytes = Number(row.rxBytes);
      const physicalBytes = Number(row.physicalBytes);
      if (row.date === todayKey) traffic.todayBytes += physicalBytes;
      if (row.date === yesterdayKey) traffic.yesterdayBytes += physicalBytes;
      if (row.date >= monthKey && row.date <= todayKey) {
        traffic.monthBytes += physicalBytes;
        const current = nodeTraffic.get(row.nodeId) ?? {
          physicalBytes: 0,
          lastSeenAt: null,
        };
        current.physicalBytes += physicalBytes;
        if (
          row.lastSeenAt &&
          (!current.lastSeenAt || row.lastSeenAt > current.lastSeenAt)
        ) {
          current.lastSeenAt = row.lastSeenAt;
        }
        nodeTraffic.set(row.nodeId, current);
      }
      const currentTrend = trendByDate.get(row.date) ?? {
        txBytes: 0,
        rxBytes: 0,
        physicalBytes: 0,
      };
      currentTrend.txBytes += txBytes;
      currentTrend.rxBytes += rxBytes;
      currentTrend.physicalBytes += physicalBytes;
      trendByDate.set(row.date, currentTrend);
    }
    const trend = Array.from({ length: 14 }, (_, index) => {
      const date = this.shiftDateKey(todayKey, index - 13);
      const row = trendByDate.get(date);
      const txBytes = row?.txBytes ?? 0;
      const rxBytes = row?.rxBytes ?? 0;
      return {
        date,
        txBytes,
        rxBytes,
        physicalBytes: row?.physicalBytes ?? 0,
      };
    });
    const subscriptions = Object.fromEntries(
      subscriptionRows.map((row) => [
        row.status.toLowerCase(),
        Number(row.count),
      ]),
    );
    const auth = Object.fromEntries(
      authRows.map((row) => [
        row.granted ? 'granted' : 'denied',
        Number(row.count),
      ]),
    );

    return {
      generatedAt: now.toISOString(),
      timezone: 'Asia/Shanghai',
      freshnessSeconds: PRESENCE_FRESHNESS_MS / 1000,
      metrics: {
        todayPhysicalBytes: traffic.todayBytes,
        yesterdayPhysicalBytes: traffic.yesterdayBytes,
        monthPhysicalBytes: traffic.monthBytes,
        activePlanSubscribers: Number(subscriberRows[0]?.count ?? 0n),
        onlineUsers: Number(online.users),
        activeConnections: Number(online.connections),
      },
      trend,
      nodes: nodeRows
        .map((node) => {
          const traffic = nodeTraffic.get(node.id);
          return {
            ...node,
            protocol: node.protocol.toLowerCase(),
            physicalBytes: traffic?.physicalBytes ?? 0,
            onlineUsers: Number(node.onlineUsers),
            activeConnections: Number(node.activeConnections),
            lastSeenAt: traffic?.lastSeenAt?.toISOString() ?? null,
          };
        })
        .sort(
          (left, right) =>
            right.physicalBytes - left.physicalBytes ||
            left.label.localeCompare(right.label),
        ),
      subscriptions: {
        active: subscriptions.active ?? 0,
        expired: subscriptions.expired ?? 0,
        paused: subscriptions.paused ?? 0,
        canceled: subscriptions.canceled ?? 0,
      },
      auth: { granted: auth.granted ?? 0, denied: auth.denied ?? 0 },
    };
  }

  private shanghaiDateKey(date: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private startOfShanghaiDate(date: string) {
    return new Date(`${date}T00:00:00+08:00`);
  }

  private shiftDateKey(date: string, days: number) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days))
      .toISOString()
      .slice(0, 10);
  }
}
