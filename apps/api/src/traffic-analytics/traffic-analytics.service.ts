import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TrafficQuery {
  from?: string;
  to?: string;
  userId?: string;
  productId?: string;
  nodeId?: string;
  poolId?: string;
  page?: string;
  pageSize?: string;
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

@Injectable()
export class TrafficAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: TrafficQuery) {
    const where = this.sqlWhere(query);
    const [totalRows, trendRows, users, products, nodes, pools] =
      await Promise.all([
        this.prisma.$queryRaw<TrafficTotalsRow[]>(Prisma.sql`
          SELECT
            COALESCE(SUM(r."txBytes" + r."rxBytes"), 0)::bigint AS "physicalBytes",
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
            COALESCE(SUM(r."txBytes" + r."rxBytes"), 0)::bigint AS "physicalBytes",
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
            COALESCE(SUM(r."txBytes" + r."rxBytes"), 0)::bigint AS "bytes"
          FROM "UsageRollup" r
          JOIN "Node" node ON node."id" = r."nodeId"
          ${where}
          GROUP BY node."id", node."label"
          ORDER BY "bytes" DESC
          LIMIT 10
        `),
        this.prisma.$queryRaw<TrafficRankingRow[]>(Prisma.sql`
          SELECT
            pool."id" AS "id",
            pool."name" AS "name",
            COALESCE(SUM(r."txBytes" + r."rxBytes"), 0)::bigint AS "bytes"
          FROM "UsageRollup" r
          JOIN "NodePoolMember" member ON member."nodeId" = r."nodeId"
          JOIN "NodePool" pool ON pool."id" = member."poolId"
          ${where}
          GROUP BY pool."id", pool."name"
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
        pools: this.presentRanking(pools),
      },
    };
  }

  async details(query: TrafficQuery) {
    const where = this.where(query);
    const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(Number.parseInt(query.pageSize ?? '50', 10) || 50, 1),
      5000,
    );
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
        orderBy: { bucketStart: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.usageRollup.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        bucketStart: row.bucketStart.toISOString(),
        userId: row.userId,
        userEmail: row.user.email,
        nodeId: row.nodeId,
        nodeLabel: row.node.label,
        txBytes: Number(row.txBytes),
        rxBytes: Number(row.rxBytes),
        physicalBytes: Number(row.txBytes + row.rxBytes),
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
    };
  }

  async exportCsv(query: TrafficQuery) {
    const details = await this.details({
      ...query,
      page: '1',
      pageSize: '5000',
    });
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
    const rows = details.items.map((item) => [
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
      node: query.poolId
        ? { poolMemberships: { some: { poolId: query.poolId } } }
        : undefined,
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
    if (query.poolId) {
      conditions.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM "NodePoolMember" selected_pool
          WHERE selected_pool."nodeId" = r."nodeId"
            AND selected_pool."poolId" = ${query.poolId}
        )
      `);
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
