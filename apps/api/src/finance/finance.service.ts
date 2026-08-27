import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, RefundMethod, RefundStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pageResponse, parsePage } from '../common/pagination';
import { ReferralService } from '../referrals/referral.service';
import type {
  CreateNodeCostDto,
  CreateRefundDto,
  UpsertAnnualOperatingCostDto,
} from './finance.dto';

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

interface NodeCostSummaryRow {
  nodeId: string;
  nodeLabel: string;
  amortizedCents: bigint;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly referrals?: ReferralService,
  ) {}

  async summary(query: FinanceQuery) {
    const range = this.range(query);
    const orderWhere = this.summaryOrderWhere(query, range);
    const [orderGroups, refunds, costs, walletLiability, payments] =
      await Promise.all([
        this.prisma.manualOrder.groupBy({
          by: ['source', 'status'],
          where: orderWhere,
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
        this.prisma.refund.aggregate({
          where: {
            status: RefundStatus.APPLIED,
            processedAt: { gte: range.from, lt: range.to },
            order: query.userId ? { userId: query.userId } : undefined,
          },
          _sum: { amountCents: true },
        }),
        this.prisma.$queryRaw<NodeCostSummaryRow[]>(Prisma.sql`
          SELECT
            cost."nodeId" AS "nodeId",
            node."label" AS "nodeLabel",
            COALESCE(SUM(ROUND(
              cost."amountCents" *
              GREATEST(
                0,
                EXTRACT(EPOCH FROM (
                  LEAST(COALESCE(cost."effectiveTo", ${range.to}), ${range.to}) -
                  GREATEST(cost."effectiveFrom", ${range.from})
                ))
              ) /
              GREATEST(
                86400,
                EXTRACT(EPOCH FROM (
                  COALESCE(cost."effectiveTo", ${range.to}) - cost."effectiveFrom"
                ))
              )
            )), 0)::bigint AS "amortizedCents"
          FROM "NodeCost" cost
          JOIN "Node" node ON node."id" = cost."nodeId"
          WHERE cost."effectiveFrom" < ${range.to}
            AND (cost."effectiveTo" IS NULL OR cost."effectiveTo" > ${range.from})
          GROUP BY cost."nodeId", node."label"
        `),
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
    const fulfilled = orderGroups.filter((group) => group.status === 'APPLIED');
    const revenueFor = (...sources: string[]) =>
      fulfilled
        .filter((group) => sources.includes(group.source))
        .reduce((sum, group) => sum + (group._sum.amountCents ?? 0), 0);
    const walletRevenueCents = revenueFor('WALLET', 'PAYMENT');
    const manualRevenueCents = revenueFor('ADMIN', 'LEGACY');
    const cdkRevenueCents = revenueFor('CDK');
    const refundCents = refunds._sum.amountCents ?? 0;
    const amortizedNodeCostCents = costs.reduce(
      (sum, cost) => sum + Number(cost.amortizedCents),
      0,
    );
    const fulfilledNetRevenueCents =
      walletRevenueCents + manualRevenueCents + cdkRevenueCents;
    return {
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      fulfilledNetRevenueCents,
      walletRevenueCents,
      manualRevenueCents,
      cdkRevenueCents,
      // Compatibility alias for the current admin UI.
      cdkEntitlementValueCents: cdkRevenueCents,
      refundCents,
      amortizedNodeCostCents,
      grossProfitCents:
        fulfilledNetRevenueCents - refundCents - amortizedNodeCostCents,
      walletLiabilityCents: walletLiability._sum.balanceCents ?? 0,
      appliedOrders: fulfilled.reduce(
        (sum, group) => sum + group._count._all,
        0,
      ),
      pendingOrders: orderGroups
        .filter((group) => group.status === 'PENDING')
        .reduce((sum, group) => sum + group._count._all, 0),
      paymentBreakdown: payments.map((payment) => ({
        source: payment.source.toLowerCase(),
        status: payment.status.toLowerCase(),
        amountCents: payment._sum.amountCents ?? 0,
        count: payment._count._all,
      })),
      nodeCosts: costs.map((cost) => ({
        nodeId: cost.nodeId,
        nodeLabel: cost.nodeLabel,
        amortizedCents: Number(cost.amortizedCents),
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.manualOrder.count({ where }),
    ]);
    return pageResponse(
      items.map((order) => ({
        id: order.id,
        userId: order.userId,
        userEmail: order.user.email,
        productId: order.catalogOffer?.productId ?? null,
        productName:
          order.productNameSnapshot ?? order.catalogOffer?.product.name ?? null,
        status: order.status.toLowerCase(),
        source: order.source.toLowerCase(),
        amountCents: order.amountCents,
        basePriceCents: order.basePriceCents,
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
      take,
    );
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.walletLedgerEntry.count({ where }),
    ]);
    return pageResponse(
      items.map((entry) => ({
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
      take,
    );
  }

  async refunds(query: FinanceQuery) {
    const range = this.range(query);
    const { skip, take, page } = this.pagination(query);
    const where: Prisma.RefundWhereInput = {
      createdAt: { gte: range.from, lt: range.to },
      status: query.status
        ? (query.status.toUpperCase() as RefundStatus)
        : undefined,
      order: query.userId ? { userId: query.userId } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        include: { order: { include: { user: true } }, processedBy: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return pageResponse(
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
      total,
      page,
      take,
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
      if (this.referrals) {
        await this.referrals.reverseForRefund(tx, orderId, actorId, refund.id);
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
    const { skip, take, page } = this.pagination(query);
    const where: Prisma.NodeCostWhereInput = {
      effectiveFrom: { lt: range.to },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: range.from } }],
    };
    const [items, total] = await Promise.all([
      this.prisma.nodeCost.findMany({
        where,
        include: { node: true },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.nodeCost.count({ where }),
    ]);
    return pageResponse(
      items.map((cost) => ({
        id: cost.id,
        nodeId: cost.nodeId,
        nodeLabel: cost.node.label,
        amountCents: cost.amountCents,
        amortizedCents: this.amortizedCost(cost, range.from, range.to),
        effectiveFrom: cost.effectiveFrom.toISOString(),
        effectiveTo: cost.effectiveTo?.toISOString() ?? null,
        providerReference: cost.providerReference,
        note: cost.note,
      })),
      total,
      page,
      take,
    );
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

  async upsertAnnualOperatingCost(
    year: number,
    input: UpsertAnnualOperatingCostDto,
    actorId: string,
  ) {
    this.requireReportYear(year);
    const cost = await this.prisma.annualOperatingCost.upsert({
      where: { year },
      create: {
        year,
        totalCostCents: input.totalCostCents,
        updatedById: actorId,
      },
      update: {
        totalCostCents: input.totalCostCents,
        updatedById: actorId,
      },
      include: { updatedBy: { select: { email: true } } },
    });
    return {
      year: cost.year,
      totalCostCents: cost.totalCostCents,
      updatedByEmail: cost.updatedBy?.email ?? null,
      updatedAt: cost.updatedAt.toISOString(),
    };
  }

  async annualBreakEven(year: number) {
    this.requireReportYear(year);
    const range = this.shanghaiYearRange(year);
    const [cost, revenue, refunds] = await Promise.all([
      this.prisma.annualOperatingCost.findUnique({
        where: { year },
        include: { updatedBy: { select: { email: true } } },
      }),
      this.prisma.manualOrder.aggregate({
        where: {
          status: 'APPLIED',
          processedAt: { gte: range.from, lt: range.to },
        },
        _sum: { amountCents: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          status: RefundStatus.APPLIED,
          processedAt: { gte: range.from, lt: range.to },
        },
        _sum: { amountCents: true },
      }),
    ]);
    const recognizedRevenueCents = revenue._sum.amountCents ?? 0;
    const refundCents = refunds._sum.amountCents ?? 0;
    const netRevenueCents = recognizedRevenueCents - refundCents;
    const annualCostCents = cost?.totalCostCents ?? null;
    const differenceCents =
      annualCostCents == null ? null : netRevenueCents - annualCostCents;
    const status =
      annualCostCents == null
        ? 'unconfigured'
        : differenceCents != null && differenceCents >= 0
          ? 'recovered'
          : 'not_recovered';
    const progressPercent =
      annualCostCents == null
        ? null
        : annualCostCents === 0
          ? 100
          : Math.min(
              100,
              Math.max(
                0,
                Math.round((netRevenueCents / annualCostCents) * 1000) / 10,
              ),
            );

    return {
      year,
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      status,
      annualCostCents,
      recognizedRevenueCents,
      refundCents,
      netRevenueCents,
      progressPercent,
      differenceCents,
      remainingCents:
        differenceCents == null ? null : Math.max(-differenceCents, 0),
      profitCents:
        differenceCents == null ? null : Math.max(differenceCents, 0),
      updatedByEmail: cost?.updatedBy?.email ?? null,
      updatedAt: cost?.updatedAt.toISOString() ?? null,
    };
  }

  async exportCsv(kind: string, query: FinanceQuery) {
    const records: Array<Record<string, unknown>> = [];
    let page = 1;
    let totalPages = 1;
    do {
      const response =
        kind === 'ledger'
          ? await this.ledger({
              ...query,
              page: String(page),
              pageSize: '100',
            })
          : await this.orders({
              ...query,
              page: String(page),
              pageSize: '100',
            });
      records.push(...response.items);
      totalPages = response.totalPages;
      page += 1;
    } while (page <= totalPages);
    const keys = records.length ? Object.keys(records[0]) : ['id'];
    return `\uFEFF${[
      keys,
      ...records.map((record) => keys.map((key) => record[key])),
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

  private requireReportYear(year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException(
        'Report year must be between 2000 and 2100',
      );
    }
  }

  private shanghaiYearRange(year: number) {
    return {
      from: new Date(`${year}-01-01T00:00:00+08:00`),
      to: new Date(`${year + 1}-01-01T00:00:00+08:00`),
    };
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

  private summaryOrderWhere(
    query: FinanceQuery,
    range: { from: Date; to: Date },
  ): Prisma.ManualOrderWhereInput {
    const status = query.status?.toUpperCase();
    const dateRange = { gte: range.from, lt: range.to };
    const timeByRecognition =
      status === 'APPLIED'
        ? [{ status: 'APPLIED' as const, processedAt: dateRange }]
        : status === 'PENDING'
          ? [{ status: 'PENDING' as const, createdAt: dateRange }]
          : status
            ? [{ status: status as never, createdAt: dateRange }]
            : [
                { status: 'APPLIED' as const, processedAt: dateRange },
                { status: 'PENDING' as const, createdAt: dateRange },
              ];
    return {
      userId: query.userId,
      source: query.source ? (query.source.toUpperCase() as never) : undefined,
      catalogOffer: query.productId
        ? { productId: query.productId }
        : undefined,
      OR: timeByRecognition,
    };
  }

  private pagination(query: FinanceQuery) {
    const { page, pageSize, skip } = parsePage(query, {
      defaultPageSize: 20,
      maxPageSize: 100,
    });
    return { page, take: pageSize, skip };
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
