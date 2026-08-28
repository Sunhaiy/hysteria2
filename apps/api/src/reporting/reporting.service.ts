import { Injectable } from '@nestjs/common';
import {
  OrderKind,
  OrderSource,
  OrderStatus,
  UsageImportBatchStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const HEALTHY_NODE_WINDOW_MS = 3 * 60 * 1000;

@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  async getCommerceSummary(now = new Date()) {
    const [orderGroups, nodes, pendingUsageBatches] = await Promise.all([
      this.prisma.manualOrder.groupBy({
        by: ['source', 'kind', 'status'],
        _count: { _all: true },
        _sum: {
          amountCents: true,
          basePriceCents: true,
          discountCents: true,
        },
      }),
      this.prisma.node.findMany({
        where: { retiredAt: null },
        select: { active: true, lastSyncAt: true, lastSyncError: true },
      }),
      this.prisma.usageImportBatch.count({
        where: { status: UsageImportBatchStatus.APPLIED },
      }),
    ]);

    const appliedOrders = this.sumGroups(
      orderGroups,
      (group) => group.status === OrderStatus.APPLIED,
    );
    const pendingOrders = this.sumGroups(
      orderGroups,
      (group) => group.status === OrderStatus.PENDING,
    );
    const voidOrders = this.sumGroups(
      orderGroups,
      (group) => group.status === OrderStatus.VOID,
    );
    const consideredOrders = appliedOrders + pendingOrders + voidOrders;
    const activeNodes = nodes.filter((node) => node.active);
    const healthyNodes = activeNodes.filter(
      (node) =>
        !node.lastSyncError &&
        node.lastSyncAt &&
        now.getTime() - node.lastSyncAt.getTime() <= HEALTHY_NODE_WINDOW_MS,
    );
    const syncDelays = activeNodes
      .filter((node) => node.lastSyncAt)
      .map((node) =>
        Math.max(
          0,
          Math.floor((now.getTime() - node.lastSyncAt!.getTime()) / 1000),
        ),
      );

    return {
      generatedAt: now.toISOString(),
      commerce: {
        walletRevenueCents: this.sumAmount(
          orderGroups,
          (group) =>
            group.status === OrderStatus.APPLIED &&
            group.source === OrderSource.WALLET,
        ),
        cdkEntitlementValueCents: this.sumAmount(
          orderGroups,
          (group) =>
            group.status === OrderStatus.APPLIED &&
            group.source === OrderSource.CDK,
        ),
        appliedOrders,
        pendingOrders,
        voidOrders,
        completionRatePercent:
          consideredOrders === 0
            ? 0
            : Math.round((appliedOrders / consideredOrders) * 10000) / 100,
        discountCents: orderGroups.reduce(
          (total, group) => total + (group._sum.discountCents ?? 0),
          0,
        ),
        byKind: {
          plan: this.kindSummary(orderGroups, OrderKind.RENEWAL),
          trafficPack: this.kindSummary(orderGroups, OrderKind.TRAFFIC_PACK),
        },
        refunds: { available: false as const },
        payments: { available: false as const },
      },
      nodes: {
        total: nodes.length,
        active: activeNodes.length,
        healthy: healthyNodes.length,
        stale: activeNodes.filter(
          (node) =>
            !node.lastSyncError &&
            (!node.lastSyncAt ||
              now.getTime() - node.lastSyncAt.getTime() >
                HEALTHY_NODE_WINDOW_MS),
        ).length,
        error: activeNodes.filter((node) => Boolean(node.lastSyncError)).length,
        availabilityPercent:
          activeNodes.length === 0
            ? 0
            : Math.round((healthyNodes.length / activeNodes.length) * 10000) /
              100,
        maxSyncDelaySeconds: syncDelays.length ? Math.max(...syncDelays) : null,
        pendingUsageBatches,
      },
    };
  }

  async exportOrdersCsv() {
    const orders = await this.prisma.manualOrder.findMany({
      include: { user: true, processedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    const header = [
      '订单 ID',
      '创建时间',
      '处理时间',
      '用户邮箱',
      '用户名称',
      '状态',
      '类型',
      '来源',
      '商品 SKU',
      '商品名称',
      '原价（分）',
      '折扣（分）',
      '成交额（分）',
      '币种',
      '套餐天数',
      '流量包有效期（天）',
      '流量字节',
      '权益到期时间',
      '处理人',
      '幂等键',
      '备注',
    ];
    const rows = orders.map((order) => [
      order.id,
      order.createdAt.toISOString(),
      order.processedAt?.toISOString() ?? '',
      order.user.email,
      order.user.displayName,
      order.status,
      order.kind,
      order.source,
      order.productSlugSnapshot ?? '',
      order.productNameSnapshot ?? '',
      order.basePriceCents ?? '',
      order.discountCents,
      order.amountCents,
      order.currency,
      order.durationDays ?? '',
      order.validityDays ?? '',
      order.trafficBytes?.toString() ?? '',
      order.entitlementExpiresAt?.toISOString() ?? '',
      order.processedBy?.email ?? '',
      order.idempotencyKey ?? '',
      order.note ?? '',
    ]);

    return `\uFEFF${[header, ...rows]
      .map((row) => row.map((value) => this.csvCell(value)).join(','))
      .join('\r\n')}\r\n`;
  }

  private sumGroups<T extends { _count: { _all: number } }>(
    groups: T[],
    predicate: (group: T) => boolean,
  ) {
    return groups
      .filter(predicate)
      .reduce((total, group) => total + group._count._all, 0);
  }

  private sumAmount<T extends { _sum: { amountCents: number | null } }>(
    groups: T[],
    predicate: (group: T) => boolean,
  ) {
    return groups
      .filter(predicate)
      .reduce((total, group) => total + (group._sum.amountCents ?? 0), 0);
  }

  private kindSummary<
    T extends {
      kind: OrderKind;
      status: OrderStatus;
      _count: { _all: number };
      _sum: { amountCents: number | null };
    },
  >(groups: T[], kind: OrderKind) {
    const applied = groups.filter(
      (group) => group.kind === kind && group.status === OrderStatus.APPLIED,
    );
    return {
      orders: applied.reduce((total, group) => total + group._count._all, 0),
      valueCents: applied.reduce(
        (total, group) => total + (group._sum.amountCents ?? 0),
        0,
      ),
    };
  }

  private csvCell(value: string | number) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }
}
