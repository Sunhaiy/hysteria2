import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RefundMethod, RefundStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateNodeCostDto, CreateRefundDto } from './finance.dto';

export interface FinanceQuery {
  from?: string;
  to?: string;
  productId?: string;
  source?: string;
  status?: string;
  userId?: string;
  page?: string;
  pageSize?: string;
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: FinanceQuery) {
    const range = this.range(query);
    const orderWhere = this.orderWhere(query, range);
    const [orders, refunds, costs, walletLiability, payments] =
      await Promise.all([
        this.prisma.manualOrder.findMany({ where: orderWhere }),
        this.prisma.refund.findMany({
          where: {
            status: RefundStatus.APPLIED,
            processedAt: { gte: range.from, lt: range.to },
            order: query.userId ? { userId: query.userId } : undefined,
          },
        }),
        this.prisma.nodeCost.findMany({
          where: {
            effectiveFrom: { lt: range.to },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: range.from } }],
          },
          include: { node: true },
        }),
        this.prisma.user.aggregate({
          where: { role: 'MEMBER', balanceCents: { gt: 0 } },
          _sum: { balanceCents: true },
        }),
        this.prisma.paymentRecord.groupBy({
          by: ['source', 'status'],
          where: { createdAt: { gte: range.from, lt: range.to } },
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
      ]);
    const fulfilled = orders.filter((order) => order.status === 'APPLIED');
    const walletRevenueCents = fulfilled
      .filter(
        (order) => order.source === 'WALLET' || order.source === 'PAYMENT',
      )
      .reduce((sum, order) => sum + order.amountCents, 0);
    const manualRevenueCents = fulfilled
      .filter((order) => order.source === 'ADMIN' || order.source === 'LEGACY')
      .reduce((sum, order) => sum + order.amountCents, 0);
    const cdkEntitlementValueCents = fulfilled
      .filter((order) => order.source === 'CDK')
      .reduce((sum, order) => sum + order.amountCents, 0);
    const refundCents = refunds.reduce(
      (sum, refund) => sum + refund.amountCents,
      0,
    );
    const amortizedNodeCostCents = costs.reduce(
      (sum, cost) => sum + this.amortizedCost(cost, range.from, range.to),
      0,
    );
    const fulfilledNetRevenueCents = walletRevenueCents + manualRevenueCents;
    return {
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      fulfilledNetRevenueCents,
      walletRevenueCents,
      manualRevenueCents,
      cdkEntitlementValueCents,
      refundCents,
      amortizedNodeCostCents,
      grossProfitCents:
        fulfilledNetRevenueCents - refundCents - amortizedNodeCostCents,
      walletLiabilityCents: walletLiability._sum.balanceCents ?? 0,
      appliedOrders: fulfilled.length,
      pendingOrders: orders.filter((order) => order.status === 'PENDING')
        .length,
      paymentBreakdown: payments.map((payment) => ({
        source: payment.source.toLowerCase(),
        status: payment.status.toLowerCase(),
        amountCents: payment._sum.amountCents ?? 0,
        count: payment._count._all,
      })),
      nodeCosts: costs.map((cost) => ({
        nodeId: cost.nodeId,
        nodeLabel: cost.node.label,
        amortizedCents: this.amortizedCost(cost, range.from, range.to),
      })),
    };
  }

  async orders(query: FinanceQuery) {
    const range = this.range(query);
    const { skip, take, page } = this.pagination(query);
    const where = this.orderWhere(query, range);
    const [items, total] = await Promise.all([
      this.prisma.manualOrder.findMany({
        where,
        include: {
          user: true,
          catalogOffer: { include: { product: true } },
          paymentRecords: true,
          refunds: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.manualOrder.count({ where }),
    ]);
    return {
      items: items.map((order) => ({
        id: order.id,
        userId: order.userId,
        userEmail: order.user.email,
        productId: order.catalogOffer?.productId ?? null,
        productName:
          order.productNameSnapshot ?? order.catalogOffer?.product.name ?? null,
        status: order.status.toLowerCase(),
        source: order.source.toLowerCase(),
        amountCents: order.amountCents,
        discountCents: order.discountCents,
        paidCents: order.paymentRecords
          .filter((payment) => payment.status === 'SETTLED')
          .reduce((sum, payment) => sum + payment.amountCents, 0),
        refundedCents: order.refunds
          .filter((refund) => refund.status === 'APPLIED')
          .reduce((sum, refund) => sum + refund.amountCents, 0),
        createdAt: order.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: take,
    };
  }

  async ledger(query: FinanceQuery) {
    const range = this.range(query);
    const { skip, take, page } = this.pagination(query);
    const where: Prisma.WalletLedgerEntryWhereInput = {
      createdAt: { gte: range.from, lt: range.to },
      userId: query.userId,
    };
    const [items, total] = await Promise.all([
      this.prisma.walletLedgerEntry.findMany({
        where,
        include: { user: true, actor: true, order: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.walletLedgerEntry.count({ where }),
    ]);
    return {
      items: items.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        userEmail: entry.user.email,
        actorEmail: entry.actor?.email ?? null,
        orderId: entry.orderId,
        kind: entry.kind.toLowerCase(),
        amountCents: entry.amountCents,
        beforeBalanceCents: entry.beforeBalanceCents,
        afterBalanceCents: entry.afterBalanceCents,
        idempotencyKey: entry.idempotencyKey,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: take,
    };
  }

  async refunds(query: FinanceQuery) {
    const range = this.range(query);
    return this.prisma.refund
      .findMany({
        where: {
          createdAt: { gte: range.from, lt: range.to },
          status: query.status
            ? (query.status.toUpperCase() as RefundStatus)
            : undefined,
          order: query.userId ? { userId: query.userId } : undefined,
        },
        include: { order: { include: { user: true } }, processedBy: true },
        orderBy: { createdAt: 'desc' },
      })
      .then((items) =>
        items.map((refund) => ({
          id: refund.id,
          orderId: refund.orderId,
          userEmail: refund.order.user.email,
          method: refund.method.toLowerCase(),
          status: refund.status.toLowerCase(),
          amountCents: refund.amountCents,
          reason: refund.reason,
          processedByEmail: refund.processedBy?.email ?? null,
          processedAt: refund.processedAt?.toISOString() ?? null,
          createdAt: refund.createdAt.toISOString(),
        })),
      );
  }

  async createRefund(orderId: string, input: CreateRefundDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.manualOrder.findUnique({
        where: { id: orderId },
        include: { refunds: true, user: true },
      });
      if (!order || order.status !== 'APPLIED') {
        throw new NotFoundException('Applied order not found');
      }
      const refunded = order.refunds
        .filter((refund) => refund.status === RefundStatus.APPLIED)
        .reduce((sum, refund) => sum + refund.amountCents, 0);
      if (refunded + input.amountCents > order.amountCents) {
        throw new BadRequestException('Refund exceeds the refundable amount');
      }
      const processedAt = new Date();
      const refund = await tx.refund.create({
        data: {
          orderId,
          processedById: actorId,
          method:
            input.method === 'wallet'
              ? RefundMethod.WALLET
              : RefundMethod.MANUAL,
          status: RefundStatus.APPLIED,
          amountCents: input.amountCents,
          reason: input.reason,
          processedAt,
        },
      });
      if (input.method === 'wallet') {
        const before = order.user.balanceCents;
        const after = before + input.amountCents;
        await tx.user.update({
          where: { id: order.userId },
          data: { balanceCents: after },
        });
        const legacy = await tx.walletTransaction.create({
          data: {
            userId: order.userId,
            amountCents: input.amountCents,
            kind: 'REFUND',
            note: input.reason,
          },
        });
        await tx.walletLedgerEntry.create({
          data: {
            legacyTransactionId: legacy.id,
            userId: order.userId,
            actorId,
            orderId,
            amountCents: input.amountCents,
            beforeBalanceCents: before,
            afterBalanceCents: after,
            kind: 'REFUND',
            idempotencyKey: `refund:${refund.id}`,
            note: input.reason,
          },
        });
      }
      return {
        ...refund,
        method: refund.method.toLowerCase(),
        status: 'applied',
      };
    });
  }

  async nodeCosts(query: FinanceQuery) {
    const range = this.range(query);
    const items = await this.prisma.nodeCost.findMany({
      where: {
        effectiveFrom: { lt: range.to },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: range.from } }],
      },
      include: { node: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    return items.map((cost) => ({
      id: cost.id,
      nodeId: cost.nodeId,
      nodeLabel: cost.node.label,
      amountCents: cost.amountCents,
      amortizedCents: this.amortizedCost(cost, range.from, range.to),
      effectiveFrom: cost.effectiveFrom.toISOString(),
      effectiveTo: cost.effectiveTo?.toISOString() ?? null,
      providerReference: cost.providerReference,
      note: cost.note,
    }));
  }

  createNodeCost(input: CreateNodeCostDto) {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
    if (
      Number.isNaN(effectiveFrom.getTime()) ||
      (effectiveTo &&
        (Number.isNaN(effectiveTo.getTime()) || effectiveTo <= effectiveFrom))
    ) {
      throw new BadRequestException('Invalid node cost effective dates');
    }
    return this.prisma.nodeCost.create({
      data: {
        nodeId: input.nodeId,
        amountCents: input.amountCents,
        effectiveFrom,
        effectiveTo,
        providerReference: input.providerReference,
        note: input.note,
      },
    });
  }

  async exportCsv(kind: string, query: FinanceQuery) {
    const records =
      kind === 'ledger'
        ? (await this.ledger({ ...query, pageSize: '5000' })).items
        : (await this.orders({ ...query, pageSize: '5000' })).items;
    const keys = records.length ? Object.keys(records[0]) : ['id'];
    return `\uFEFF${[
      keys,
      ...records.map((record) =>
        keys.map((key) => record[key as keyof typeof record]),
      ),
    ]
      .map((row) => row.map((value) => this.csv(value)).join(','))
      .join('\r\n')}\r\n`;
  }

  private range(query: FinanceQuery) {
    const to = query.to ? new Date(`${query.to}T00:00:00+08:00`) : new Date();
    const from = query.from
      ? new Date(`${query.from}T00:00:00+08:00`)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to
    ) {
      throw new BadRequestException('Invalid report date range');
    }
    return { from, to };
  }

  private orderWhere(
    query: FinanceQuery,
    range: { from: Date; to: Date },
  ): Prisma.ManualOrderWhereInput {
    return {
      createdAt: { gte: range.from, lt: range.to },
      userId: query.userId,
      source: query.source ? (query.source.toUpperCase() as never) : undefined,
      status: query.status ? (query.status.toUpperCase() as never) : undefined,
      catalogOffer: query.productId
        ? { productId: query.productId }
        : undefined,
    };
  }

  private pagination(query: FinanceQuery) {
    const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
    const take = Math.min(
      Math.max(Number.parseInt(query.pageSize ?? '50', 10) || 50, 1),
      5000,
    );
    return { page, take, skip: (page - 1) * take };
  }

  private amortizedCost(
    cost: {
      amountCents: number;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    },
    from: Date,
    to: Date,
  ) {
    const contractTo = cost.effectiveTo ?? to;
    const overlapStart = Math.max(from.getTime(), cost.effectiveFrom.getTime());
    const overlapEnd = Math.min(to.getTime(), contractTo.getTime());
    if (overlapEnd <= overlapStart) return 0;
    const day = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(
      1,
      Math.ceil((contractTo.getTime() - cost.effectiveFrom.getTime()) / day),
    );
    const overlapDays = Math.ceil((overlapEnd - overlapStart) / day);
    return Math.round((cost.amountCents * overlapDays) / totalDays);
  }

  private csv(value: unknown) {
    let text = '';
    if (value instanceof Date) {
      text = value.toISOString();
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean'
    ) {
      text = String(value);
    } else if (value !== null && value !== undefined) {
      text = JSON.stringify(value) ?? '';
    }
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }
}
