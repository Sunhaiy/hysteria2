import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pageResponse, parsePage } from '../common/pagination';

export interface TrafficQuery {
  from?: string;
  to?: string;
  userId?: string;
  productId?: string;
  nodeId?: string;
  page?: string;
  pageSize?: string;
}

export interface ServerTrafficQuery {
  month?: string;
}

interface TrafficTotalsRow {
  physicalBytes: bigint;
  accountedBytes: bigint;
  allocatedBytes: bigint;
  overageBytes: bigint;
  records: bigint;
}

interface TrafficTrendRow {
  date: string;
  physicalBytes: bigint;
  accountedBytes: bigint;
  allocatedBytes: bigint;
}

interface TrafficRankingRow {
  id: string;
  name: string;
  bytes: bigint;
}

interface ServerTrafficDailyRow {
  serverId: string;
  serverName: string;
  date: string | null;
  txBytes: bigint;
  rxBytes: bigint;
  physicalBytes: bigint;
}

@Injectable()
export class TrafficAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: TrafficQuery) {
    const where = this.sqlWhere(query);
    const [totalRows, trendRows, users, products, nodes] = await Promise.all([
      this.prisma.$queryRaw<TrafficTotalsRow[]>(Prisma.sql`
          SELECT
            COALESCE(SUM(COALESCE(r."rawBytes", r."txBytes" + r."rxBytes")), 0)::bigint AS "physicalBytes",
            COALESCE(SUM(COALESCE(r."accountedBytes", r."txBytes" + r."rxBytes")), 0)::bigint AS "accountedBytes",
            COALESCE(SUM((
              SELECT COALESCE(SUM(a."accountedBytes"), 0)
              FROM "UsageAllocation" a
              WHERE a."usageRollupId" = r."id"
            )), 0)::bigint AS "allocatedBytes",
            COALESCE(SUM(r."overageBytes"), 0)::bigint AS "overageBytes",
            COUNT(*)::bigint AS "records"
          FROM "UsageRollup" r
          ${where}
        `),
      this.prisma.$queryRaw<TrafficTrendRow[]>(Prisma.sql`
          SELECT
            to_char(
              date_trunc(
                'day',
                r."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'
              ),
              'YYYY-MM-DD'
            ) AS "date",
            COALESCE(SUM(COALESCE(r."rawBytes", r."txBytes" + r."rxBytes")), 0)::bigint AS "physicalBytes",
            COALESCE(SUM(COALESCE(r."accountedBytes", r."txBytes" + r."rxBytes")), 0)::bigint AS "accountedBytes",
            COALESCE(SUM((
              SELECT COALESCE(SUM(a."accountedBytes"), 0)
              FROM "UsageAllocation" a
              WHERE a."usageRollupId" = r."id"
            )), 0)::bigint AS "allocatedBytes"
          FROM "UsageRollup" r
          ${where}
          GROUP BY date_trunc(
            'day',
            r."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'
          )
          ORDER BY date_trunc(
            'day',
            r."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'
          ) ASC
        `),
      this.prisma.$queryRaw<TrafficRankingRow[]>(Prisma.sql`
          SELECT
            u."id" AS "id",
            u."email" AS "name",
            COALESCE(SUM(COALESCE(r."accountedBytes", r."txBytes" + r."rxBytes")), 0)::bigint AS "bytes"
          FROM "UsageRollup" r
          JOIN "User" u ON u."id" = r."userId"
          ${where}
          GROUP BY u."id", u."email"
          ORDER BY "bytes" DESC
          LIMIT 10
        `),
      this.prisma.$queryRaw<TrafficRankingRow[]>(Prisma.sql`
          SELECT
            product."id" AS "id",
            product."name" AS "name",
            COALESCE(SUM(allocation."accountedBytes"), 0)::bigint AS "bytes"
          FROM "UsageRollup" r
          JOIN "UsageAllocation" allocation
            ON allocation."usageRollupId" = r."id"
          JOIN "QuotaBucket" bucket
            ON bucket."id" = allocation."quotaBucketId"
          JOIN "EntitlementGrant" grant_record
            ON grant_record."id" = bucket."grantId"
          JOIN "CatalogProduct" product
            ON product."id" = grant_record."productId"
          ${where}
          GROUP BY product."id", product."name"
          ORDER BY "bytes" DESC
          LIMIT 10
        `),
      this.prisma.$queryRaw<TrafficRankingRow[]>(Prisma.sql`
          SELECT
            node."id" AS "id",
            node."label" AS "name",
            COALESCE(SUM(COALESCE(r."rawBytes", r."txBytes" + r."rxBytes")), 0)::bigint AS "bytes"
          FROM "UsageRollup" r
          JOIN "Node" node ON node."id" = r."nodeId"
          ${where}
          GROUP BY node."id", node."label"
          ORDER BY "bytes" DESC
          LIMIT 10
        `),
    ]);
    const totals = totalRows[0] ?? {
      physicalBytes: 0n,
      accountedBytes: 0n,
      allocatedBytes: 0n,
      overageBytes: 0n,
      records: 0n,
    };
    return {
      timezone: 'Asia/Shanghai',
      totals: {
        physicalBytes: Number(totals.physicalBytes),
        accountedBytes: Number(totals.accountedBytes),
        allocatedBytes: Number(totals.allocatedBytes),
        overageBytes: Number(totals.overageBytes),
        records: Number(totals.records),
      },
      trend: trendRows.map((row) => ({
        date: row.date,
        physicalBytes: Number(row.physicalBytes),
        accountedBytes: Number(row.accountedBytes),
        allocatedBytes: Number(row.allocatedBytes),
      })),
      rankings: {
        users: this.presentRanking(users),
        products: this.presentRanking(products),
        nodes: this.presentRanking(nodes),
      },
    };
  }

  async serverMonthly(query: ServerTrafficQuery = {}, now = new Date()) {
    const range = this.serverMonthRange(query.month, now);
    const rows = await this.prisma.$queryRaw<
      ServerTrafficDailyRow[]
    >(Prisma.sql`
      WITH server_inventory AS (
        SELECT
          server."id" AS "serverId",
          server."name" AS "serverName"
        FROM "NodeServer" server
        WHERE server."createdAt" < ${range.to}
          AND (server."retiredAt" IS NULL OR server."retiredAt" >= ${range.from})

        UNION ALL

        SELECT
          node."id" AS "serverId",
          node."hostname" AS "serverName"
        FROM "Node" node
        WHERE node."serverId" IS NULL
          AND node."createdAt" < ${range.to}
          AND (node."retiredAt" IS NULL OR node."retiredAt" >= ${range.from})
      ),
      daily_traffic AS (
        SELECT
          COALESCE(server."id", node."id") AS "serverId",
          to_char(
            date_trunc(
              'day',
              r."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'
            ),
            'YYYY-MM-DD'
          ) AS "date",
          COALESCE(SUM(r."txBytes"), 0)::bigint AS "txBytes",
          COALESCE(SUM(r."rxBytes"), 0)::bigint AS "rxBytes",
          COALESCE(SUM(COALESCE(r."rawBytes", r."txBytes" + r."rxBytes")), 0)::bigint AS "physicalBytes"
        FROM "UsageRollup" r
        JOIN "Node" node ON node."id" = r."nodeId"
        LEFT JOIN "NodeServer" server ON server."id" = node."serverId"
        WHERE r."bucketStart" >= ${range.from}
          AND r."bucketStart" < ${range.to}
        GROUP BY
          COALESCE(server."id", node."id"),
          date_trunc(
            'day',
            r."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'
          )
      )
      SELECT
        inventory."serverId",
        inventory."serverName",
        traffic."date",
        COALESCE(traffic."txBytes", 0)::bigint AS "txBytes",
        COALESCE(traffic."rxBytes", 0)::bigint AS "rxBytes",
        COALESCE(traffic."physicalBytes", 0)::bigint AS "physicalBytes"
      FROM server_inventory inventory
      LEFT JOIN daily_traffic traffic
        ON traffic."serverId" = inventory."serverId"
      ORDER BY traffic."date" ASC NULLS FIRST, inventory."serverName" ASC
    `);
    const dates = Array.from(
      { length: range.days },
      (_, index) => `${range.month}-${String(index + 1).padStart(2, '0')}`,
    );
    const servers = new Map<
      string,
      {
        id: string;
        name: string;
        txBytes: number;
        rxBytes: number;
        physicalBytes: number;
        days: Map<
          string,
          {
            date: string;
            txBytes: number;
            rxBytes: number;
            physicalBytes: number;
          }
        >;
      }
    >();

    for (const row of rows) {
      const server = servers.get(row.serverId) ?? {
        id: row.serverId,
        name: row.serverName,
        txBytes: 0,
        rxBytes: 0,
        physicalBytes: 0,
        days: new Map(
          dates.map((date) => [
            date,
            { date, txBytes: 0, rxBytes: 0, physicalBytes: 0 },
          ]),
        ),
      };
      const txBytes = Number(row.txBytes);
      const rxBytes = Number(row.rxBytes);
      const physicalBytes = Number(row.physicalBytes);
      server.txBytes += txBytes;
      server.rxBytes += rxBytes;
      server.physicalBytes += physicalBytes;
      if (row.date) {
        server.days.set(row.date, {
          date: row.date,
          txBytes,
          rxBytes,
          physicalBytes,
        });
      }
      servers.set(row.serverId, server);
    }

    const presentedServers = [...servers.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .map((server) => ({
        id: server.id,
        name: server.name,
        txBytes: server.txBytes,
        rxBytes: server.rxBytes,
        physicalBytes: server.physicalBytes,
        days: dates.map((date) => server.days.get(date)!),
      }));
    const today = this.shanghaiDate(now);

    return {
      timezone: 'Asia/Shanghai',
      month: range.month,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      today,
      totals: {
        txBytes: presentedServers.reduce(
          (sum, server) => sum + server.txBytes,
          0,
        ),
        rxBytes: presentedServers.reduce(
          (sum, server) => sum + server.rxBytes,
          0,
        ),
        physicalBytes: presentedServers.reduce(
          (sum, server) => sum + server.physicalBytes,
          0,
        ),
        todayPhysicalBytes: presentedServers.reduce(
          (sum, server) =>
            sum +
            (server.days.find((day) => day.date === today)?.physicalBytes ?? 0),
          0,
        ),
      },
      dates,
      servers: presentedServers,
    };
  }

  async details(query: TrafficQuery) {
    const where = this.where(query);
    const { page, pageSize, skip } = parsePage(query, {
      defaultPageSize: 20,
      maxPageSize: 100,
    });
    const [rows, total] = await Promise.all([
      this.prisma.usageRollup.findMany({
        where,
        include: {
          user: true,
          node: true,
          allocations: {
            include: {
              quotaBucket: {
                include: { grant: { include: { product: true } } },
              },
            },
          },
        },
        orderBy: [{ bucketStart: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.usageRollup.count({ where }),
    ]);
    return pageResponse(
      rows.map((row) => ({
        id: row.id,
        bucketStart: row.bucketStart.toISOString(),
        userId: row.userId,
        userEmail: row.user.email,
        nodeId: row.nodeId,
        nodeLabel: row.node.label,
        txBytes: Number(row.txBytes),
        rxBytes: Number(row.rxBytes),
        physicalBytes: Number(row.rawBytes ?? row.txBytes + row.rxBytes),
        accountedBytes: Number(row.accountedBytes ?? row.txBytes + row.rxBytes),
        allocatedBytes: row.allocations.reduce(
          (sum, allocation) => sum + Number(allocation.accountedBytes),
          0,
        ),
        overageBytes: Number(row.overageBytes),
        allocations: row.allocations.map((allocation) => ({
          productId: allocation.quotaBucket.grant.productId,
          productName: allocation.quotaBucket.grant.product.name,
          quotaBucketId: allocation.quotaBucketId,
          accountedBytes: Number(allocation.accountedBytes),
        })),
        source: row.source,
      })),
      total,
      page,
      pageSize,
    );
  }

  async exportCsv(query: TrafficQuery) {
    const items: Awaited<ReturnType<this['details']>>['items'] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const details = await this.details({
        ...query,
        page: String(page),
        pageSize: '100',
      });
      items.push(...details.items);
      totalPages = details.totalPages;
      page += 1;
    } while (page <= totalPages);
    const header = [
      '时间',
      '用户',
      '节点',
      '上行字节',
      '下行字节',
      '物理流量',
      '计费流量',
      '额度扣除',
      '超额流量',
      '商品分摊',
    ];
    const rows = items.map((item) => [
      item.bucketStart,
      item.userEmail,
      item.nodeLabel,
      item.txBytes,
      item.rxBytes,
      item.physicalBytes,
      item.accountedBytes,
      item.allocatedBytes,
      item.overageBytes,
      item.allocations
        .map(
          (allocation) =>
            `${allocation.productName}:${allocation.accountedBytes}`,
        )
        .join('|'),
    ]);
    return `\uFEFF${[header, ...rows]
      .map((row) => row.map((value) => this.csv(value)).join(','))
      .join('\r\n')}\r\n`;
  }

  private where(query: TrafficQuery): Prisma.UsageRollupWhereInput {
    const { from, to } = this.range(query);
    return {
      bucketStart: { gte: from, lt: to },
      userId: query.userId,
      nodeId: query.nodeId,
      allocations: query.productId
        ? {
            some: {
              quotaBucket: { grant: { productId: query.productId } },
            },
          }
        : undefined,
    };
  }

  private sqlWhere(query: TrafficQuery) {
    const { from, to } = this.range(query);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r."bucketStart" >= ${from}`,
      Prisma.sql`r."bucketStart" < ${to}`,
    ];
    if (query.userId) {
      conditions.push(Prisma.sql`r."userId" = ${query.userId}`);
    }
    if (query.nodeId) {
      conditions.push(Prisma.sql`r."nodeId" = ${query.nodeId}`);
    }
    if (query.productId) {
      conditions.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM "UsageAllocation" selected_allocation
          JOIN "QuotaBucket" selected_bucket
            ON selected_bucket."id" = selected_allocation."quotaBucketId"
          JOIN "EntitlementGrant" selected_grant
            ON selected_grant."id" = selected_bucket."grantId"
          WHERE selected_allocation."usageRollupId" = r."id"
            AND selected_grant."productId" = ${query.productId}
        )
      `);
    }
    return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  }

  private range(query: TrafficQuery) {
    const to = query.to ? new Date(`${query.to}T00:00:00+08:00`) : new Date();
    const from = query.from
      ? new Date(`${query.from}T00:00:00+08:00`)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to
    ) {
      throw new BadRequestException('Invalid traffic date range');
    }
    return { from, to };
  }

  private serverMonthRange(monthValue: string | undefined, now: Date) {
    const currentMonth = this.shanghaiDate(now).slice(0, 7);
    const month = monthValue?.trim() || currentMonth;
    const matched = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (!matched) {
      throw new BadRequestException('Invalid traffic month');
    }
    const year = Number(matched[1]);
    const monthNumber = Number(matched[2]);
    if (year < 2000 || year > 2100) {
      throw new BadRequestException('Invalid traffic month');
    }
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
    return {
      month,
      days: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(),
      from: new Date(`${month}-01T00:00:00+08:00`),
      to: new Date(
        `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`,
      ),
    };
  }

  private shanghaiDate(now: Date) {
    const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return [
      shanghai.getUTCFullYear(),
      String(shanghai.getUTCMonth() + 1).padStart(2, '0'),
      String(shanghai.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  private presentRanking(rows: TrafficRankingRow[]) {
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      bytes: Number(row.bytes),
    }));
  }

  private csv(value: string | number) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }
}
