import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESENCE_FRESHNESS_MS = 45_000;

interface TrafficMetricRow {
  todayBytes: bigint;
  yesterdayBytes: bigint;
  monthBytes: bigint;
}

interface TrendRow {
  date: string;
  txBytes: bigint;
  rxBytes: bigint;
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
  physicalBytes: bigint;
  onlineUsers: bigint;
  activeConnections: bigint;
  lastSeenAt: Date | null;
}

interface StatusRow {
  status: string;
  count: bigint;
}

interface AuthRow {
  granted: boolean;
  count: bigint;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(now = new Date()) {
    const todayKey = this.shanghaiDateKey(now);
    const todayStart = this.startOfShanghaiDate(todayKey);
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const monthStart = this.startOfShanghaiDate(`${todayKey.slice(0, 7)}-01`);
    const trendStart = new Date(todayStart.getTime() - 13 * DAY_MS);
    const freshSince = new Date(now.getTime() - PRESENCE_FRESHNESS_MS);

    const [
      trafficRows,
      trendRows,
      subscriberRows,
      onlineRows,
      nodeRows,
      subscriptionRows,
      authRows,
    ] = await Promise.all([
      this.prisma.$queryRaw<TrafficMetricRow[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(CASE WHEN r."bucketStart" >= ${todayStart}
            AND r."bucketStart" < ${tomorrowStart}
            THEN r."txBytes" + r."rxBytes" ELSE 0 END), 0)::bigint AS "todayBytes",
          COALESCE(SUM(CASE WHEN r."bucketStart" >= ${yesterdayStart}
            AND r."bucketStart" < ${todayStart}
            THEN r."txBytes" + r."rxBytes" ELSE 0 END), 0)::bigint AS "yesterdayBytes",
          COALESCE(SUM(CASE WHEN r."bucketStart" >= ${monthStart}
            AND r."bucketStart" < ${tomorrowStart}
            THEN r."txBytes" + r."rxBytes" ELSE 0 END), 0)::bigint AS "monthBytes"
        FROM "UsageRollup" r
        WHERE r."bucketStart" >= ${monthStart < yesterdayStart ? monthStart : yesterdayStart}
          AND r."bucketStart" < ${tomorrowStart}
      `),
      this.prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        SELECT
          to_char(
            r."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai',
            'YYYY-MM-DD'
          ) AS "date",
          COALESCE(SUM(r."txBytes"), 0)::bigint AS "txBytes",
          COALESCE(SUM(r."rxBytes"), 0)::bigint AS "rxBytes"
        FROM "UsageRollup" r
        WHERE r."bucketStart" >= ${trendStart}
          AND r."bucketStart" < ${tomorrowStart}
        GROUP BY to_char(
          r."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai',
          'YYYY-MM-DD'
        )
        ORDER BY "date" ASC
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
        WITH recent_health AS (
          SELECT DISTINCT ON (snapshot."nodeId")
            snapshot."nodeId", snapshot.healthy
          FROM "NodeHealthSnapshot" snapshot
          ORDER BY snapshot."nodeId", snapshot."checkedAt" DESC
        ), node_traffic AS (
          SELECT rollup."nodeId",
            COALESCE(SUM(rollup."txBytes" + rollup."rxBytes"), 0)::bigint AS bytes,
            MAX(rollup."bucketStart") AS "lastSeenAt"
          FROM "UsageRollup" rollup
          WHERE rollup."bucketStart" >= ${monthStart}
            AND rollup."bucketStart" < ${tomorrowStart}
          GROUP BY rollup."nodeId"
        ), node_presence AS (
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
          COALESCE(traffic.bytes, 0)::bigint AS "physicalBytes",
          COALESCE(presence.users, 0)::bigint AS "onlineUsers",
          COALESCE(presence.connections, 0)::bigint AS "activeConnections",
          traffic."lastSeenAt"
        FROM "Node" node
        LEFT JOIN "NodeServer" server ON server.id = node."serverId"
        LEFT JOIN recent_health health ON health."nodeId" = node.id
        LEFT JOIN node_traffic traffic ON traffic."nodeId" = node.id
        LEFT JOIN node_presence presence ON presence."nodeId" = node.id
        ORDER BY "physicalBytes" DESC, node.label ASC
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

    const traffic = trafficRows[0] ?? {
      todayBytes: 0n,
      yesterdayBytes: 0n,
      monthBytes: 0n,
    };
    const online = onlineRows[0] ?? { users: 0n, connections: 0n };
    const trendByDate = new Map(trendRows.map((row) => [row.date, row]));
    const trend = Array.from({ length: 14 }, (_, index) => {
      const date = this.shiftDateKey(todayKey, index - 13);
      const row = trendByDate.get(date);
      const txBytes = Number(row?.txBytes ?? 0n);
      const rxBytes = Number(row?.rxBytes ?? 0n);
      return { date, txBytes, rxBytes, physicalBytes: txBytes + rxBytes };
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
        todayPhysicalBytes: Number(traffic.todayBytes),
        yesterdayPhysicalBytes: Number(traffic.yesterdayBytes),
        monthPhysicalBytes: Number(traffic.monthBytes),
        activePlanSubscribers: Number(subscriberRows[0]?.count ?? 0n),
        onlineUsers: Number(online.users),
        activeConnections: Number(online.connections),
      },
      trend,
      nodes: nodeRows.map((node) => ({
        ...node,
        protocol: node.protocol.toLowerCase(),
        physicalBytes: Number(node.physicalBytes),
        onlineUsers: Number(node.onlineUsers),
        activeConnections: Number(node.activeConnections),
        lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
      })),
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
