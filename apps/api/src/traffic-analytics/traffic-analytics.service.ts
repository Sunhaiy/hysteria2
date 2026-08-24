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

@Injectable()
export class TrafficAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: TrafficQuery) {
    const where = this.where(query);
    const rows = await this.prisma.usageRollup.findMany({
      where,
      include: {
        user: true,
        node: { include: { poolMemberships: { include: { pool: true } } } },
        allocations: {
          include: {
            quotaBucket: {
              include: { grant: { include: { product: true } } },
            },
          },
        },
      },
      orderBy: { bucketStart: 'asc' },
    });
    const totals = rows.reduce(
      (result, row) => {
        result.physicalBytes += Number(row.txBytes + row.rxBytes);
        result.accountedBytes += Number(
          row.accountedBytes ?? row.txBytes + row.rxBytes,
        );
        result.allocatedBytes += row.allocations.reduce(
          (sum, allocation) => sum + Number(allocation.accountedBytes),
          0,
        );
        result.overageBytes += Number(row.overageBytes);
        return result;
      },
      {
        physicalBytes: 0,
        accountedBytes: 0,
        allocatedBytes: 0,
        overageBytes: 0,
      },
    );
    const trend = new Map<
      string,
      { physicalBytes: number; accountedBytes: number; allocatedBytes: number }
    >();
    const users = new Map<
      string,
      { id: string; name: string; bytes: number }
    >();
    const nodes = new Map<
      string,
      { id: string; name: string; bytes: number }
    >();
    const products = new Map<
      string,
      { id: string; name: string; bytes: number }
    >();
    const pools = new Map<
      string,
      { id: string; name: string; bytes: number }
    >();
    for (const row of rows) {
      const date = this.shanghaiDate(row.bucketStart);
      const current = trend.get(date) ?? {
        physicalBytes: 0,
        accountedBytes: 0,
        allocatedBytes: 0,
      };
      const physical = Number(row.txBytes + row.rxBytes);
      const accounted = Number(row.accountedBytes ?? row.txBytes + row.rxBytes);
      const allocated = row.allocations.reduce(
        (sum, allocation) => sum + Number(allocation.accountedBytes),
        0,
      );
      current.physicalBytes += physical;
      current.accountedBytes += accounted;
      current.allocatedBytes += allocated;
      trend.set(date, current);
      this.increment(users, row.userId, row.user.email, accounted);
      this.increment(nodes, row.nodeId, row.node.label, physical);
      for (const membership of row.node.poolMemberships) {
        this.increment(
          pools,
          membership.poolId,
          membership.pool.name,
          physical,
        );
      }
      for (const allocation of row.allocations) {
        const product = allocation.quotaBucket.grant.product;
        this.increment(
          products,
          product.id,
          product.name,
          Number(allocation.accountedBytes),
        );
      }
    }
    return {
      timezone: 'Asia/Shanghai',
      totals: { ...totals, records: rows.length },
      trend: [...trend.entries()].map(([date, values]) => ({
        date,
        ...values,
      })),
      rankings: {
        users: this.ranking(users),
        products: this.ranking(products),
        nodes: this.ranking(nodes),
        pools: this.ranking(pools),
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

  private increment(
    map: Map<string, { id: string; name: string; bytes: number }>,
    id: string,
    name: string,
    bytes: number,
  ) {
    const current = map.get(id) ?? { id, name, bytes: 0 };
    current.bytes += bytes;
    map.set(id, current);
  }

  private ranking(
    map: Map<string, { id: string; name: string; bytes: number }>,
  ) {
    return [...map.values()]
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 10);
  }

  private shanghaiDate(date: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private csv(value: string | number) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }
}
