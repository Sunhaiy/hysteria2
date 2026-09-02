import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CatalogProductKind,
  EpayPaymentStatus,
  OrderSource,
  OrderStatus,
  PaymentRecordStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AdminOrderQuery extends PageQuery {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  source?: string;
  paymentStatus?: string;
  productKind?: string;
  productId?: string;
  paymentType?: string;
}

export interface PaymentAttemptQuery extends PageQuery {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  productKind?: string;
  productId?: string;
  paymentType?: string;
}

const orderInclude = {
  user: { select: { id: true, email: true, displayName: true } },
  processedBy: { select: { id: true, email: true, displayName: true } },
  catalogOffer: {
    include: {
      product: { select: { id: true, name: true, kind: true } },
    },
  },
  paymentRecords: { orderBy: { createdAt: 'asc' as const } },
  refunds: {
    include: {
      processedBy: { select: { id: true, email: true, displayName: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  epayPaymentAttempt: true,
} satisfies Prisma.ManualOrderInclude;

type OrderWithDetails = Prisma.ManualOrderGetPayload<{
  include: typeof orderInclude;
}>;

@Injectable()
export class OrderQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminOrderQuery = {}) {
    const { page, pageSize, skip } = parsePage(query, {
      defaultPageSize: 20,
      maxPageSize: 100,
    });
    const where = this.orderWhere(query);
    const [orders, total] = await Promise.all([
      this.prisma.manualOrder.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.manualOrder.count({ where }),
    ]);
    return pageResponse(
      orders.map((order) => this.presentOrder(order)),
      total,
      page,
      pageSize,
    );
  }

  async detail(id: string) {
    const order = await this.prisma.manualOrder.findUnique({
      where: { id },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('订单不存在');
    const audits = await this.prisma.auditLog.findMany({
      where: { targetId: id },
      include: {
        actor: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return {
      ...this.presentOrder(order),
      basePriceCents: order.basePriceCents,
      discountCents: order.discountCents,
      durationDays: order.durationDays,
      validityDays: order.validityDays,
      trafficBytes: order.trafficBytes ? Number(order.trafficBytes) : null,
      entitlementExpiresAt: order.entitlementExpiresAt?.toISOString() ?? null,
      accessProfileId: order.accessProfileIdSnapshot,
      speedUpMbps: order.speedUpMbpsSnapshot,
      speedDownMbps: order.speedDownMbpsSnapshot,
      trafficMultiplier:
        order.trafficMultiplierBasisPointsSnapshot == null
          ? null
          : order.trafficMultiplierBasisPointsSnapshot / 10_000,
      processedBy: order.processedBy,
      note: order.note,
      payments: order.paymentRecords.map((payment) => ({
        id: payment.id,
        source: payment.source.toLowerCase(),
        status: payment.status.toLowerCase(),
        amountCents: payment.amountCents,
        externalRef: payment.externalRef,
        paidAt: payment.paidAt?.toISOString() ?? null,
        reconciledAt: payment.reconciledAt?.toISOString() ?? null,
        createdAt: payment.createdAt.toISOString(),
      })),
      refunds: order.refunds.map((refund) => ({
        id: refund.id,
        method: refund.method.toLowerCase(),
        status: refund.status.toLowerCase(),
        amountCents: refund.amountCents,
        reason: refund.reason,
        processedBy: refund.processedBy,
        processedAt: refund.processedAt?.toISOString() ?? null,
        createdAt: refund.createdAt.toISOString(),
      })),
      paymentAttempt: order.epayPaymentAttempt
        ? this.presentAttempt(order.epayPaymentAttempt)
        : null,
      audits: audits.map((audit) => ({
        id: audit.id,
        action: audit.action,
        actor: audit.actor,
        metadata: audit.metadata,
        createdAt: audit.createdAt.toISOString(),
      })),
    };
  }

  async paymentAttempts(query: PaymentAttemptQuery = {}) {
    await this.prisma.epayPaymentAttempt.updateMany({
      where: {
        status: EpayPaymentStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: EpayPaymentStatus.EXPIRED, activeKey: null },
    });
    const { page, pageSize, skip } = parsePage(query, {
      defaultPageSize: 20,
      maxPageSize: 100,
    });
    const where = this.attemptWhere(query);
    const [attempts, total] = await Promise.all([
      this.prisma.epayPaymentAttempt.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
          offer: {
            include: {
              product: { select: { id: true, name: true, kind: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.epayPaymentAttempt.count({ where }),
    ]);
    return pageResponse(
      attempts.map((attempt) => ({
        ...this.presentAttempt(attempt),
        user: attempt.user,
        product: {
          id: attempt.offer.product.id,
          name: attempt.offer.product.name,
          kind: attempt.offer.product.kind.toLowerCase(),
        },
        offer: {
          id: attempt.offer.id,
          name: attempt.offer.name,
          billingPeriod: attempt.offer.billingPeriod.toLowerCase(),
        },
      })),
      total,
      page,
      pageSize,
    );
  }

  async summary(now = new Date()) {
    const todayFrom = this.shanghaiStartOfDay(now);
    const monthFrom = this.shanghaiStartOfMonth(now);
    const [today, month] = await Promise.all([
      this.netRevenue(todayFrom, now),
      this.netRevenue(monthFrom, now),
    ]);
    return {
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
      generatedAt: now.toISOString(),
      today: { from: todayFrom.toISOString(), to: now.toISOString(), ...today },
      month: { from: monthFrom.toISOString(), to: now.toISOString(), ...month },
    };
  }

  private async netRevenue(from: Date, to: Date) {
    const [orders, refunds] = await Promise.all([
      this.prisma.manualOrder.aggregate({
        where: {
          status: OrderStatus.APPLIED,
          source: OrderSource.PAYMENT,
          processedAt: { gte: from, lte: to },
        },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          status: RefundStatus.APPLIED,
          processedAt: { gte: from, lte: to },
          order: { source: OrderSource.PAYMENT },
        },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
    ]);
    const grossRevenueCents = orders._sum.amountCents ?? 0;
    const refundCents = refunds._sum.amountCents ?? 0;
    return {
      grossRevenueCents,
      refundCents,
      netRevenueCents: grossRevenueCents - refundCents,
      orderCount: orders._count._all,
      refundCount: refunds._count._all,
    };
  }

  private orderWhere(query: AdminOrderQuery): Prisma.ManualOrderWhereInput {
    const q = query.q?.trim();
    const status = this.enumValue(query.status, OrderStatus, '订单状态');
    const source = this.enumValue(query.source, OrderSource, '订单来源');
    const productKind = this.enumValue(
      query.productKind,
      CatalogProductKind,
      '商品类型',
    );
    const paymentType = this.paymentType(query.paymentType);
    const range = this.dateRange(query.from, query.to);
    const and: Prisma.ManualOrderWhereInput[] = [];
    if (q) {
      and.push({
        OR: [
          { id: { contains: q, mode: 'insensitive' } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
          { user: { displayName: { contains: q, mode: 'insensitive' } } },
          { productNameSnapshot: { contains: q, mode: 'insensitive' } },
          {
            epayPaymentAttempt: {
              is: {
                OR: [
                  { merchantOrderNo: { contains: q, mode: 'insensitive' } },
                  { gatewayTradeNo: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          },
          {
            paymentRecords: {
              some: { externalRef: { contains: q, mode: 'insensitive' } },
            },
          },
        ],
      });
    }
    if (productKind) {
      and.push({ catalogOffer: { product: { kind: productKind } } });
    }
    if (query.productId?.trim()) {
      and.push({ catalogOffer: { productId: query.productId.trim() } });
    }
    if (paymentType) {
      and.push({ epayPaymentAttempt: { is: { paymentType } } });
    }
    const paymentFilter = this.orderPaymentFilter(query.paymentStatus);
    if (paymentFilter) and.push(paymentFilter);
    return {
      status,
      source,
      createdAt: range,
      AND: and.length ? and : undefined,
    };
  }

  private attemptWhere(
    query: PaymentAttemptQuery,
  ): Prisma.EpayPaymentAttemptWhereInput {
    const q = query.q?.trim();
    const paymentType = this.paymentType(query.paymentType);
    const productKind = this.enumValue(
      query.productKind,
      CatalogProductKind,
      '商品类型',
    );
    const status = this.enumValue(query.status, EpayPaymentStatus, '支付状态');
    return {
      status: status ?? {
        in: [
          EpayPaymentStatus.PENDING,
          EpayPaymentStatus.EXPIRED,
          EpayPaymentStatus.FAILED,
        ],
      },
      paymentType,
      createdAt: this.dateRange(query.from, query.to),
      offer:
        productKind || query.productId?.trim()
          ? {
              productId: query.productId?.trim() || undefined,
              product: productKind ? { kind: productKind } : undefined,
            }
          : undefined,
      OR: q
        ? [
            { merchantOrderNo: { contains: q, mode: 'insensitive' } },
            { gatewayTradeNo: { contains: q, mode: 'insensitive' } },
            { productNameSnapshot: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { displayName: { contains: q, mode: 'insensitive' } } },
          ]
        : undefined,
    };
  }

  private orderPaymentFilter(
    value?: string,
  ): Prisma.ManualOrderWhereInput | undefined {
    if (!value) return undefined;
    switch (value.toLowerCase()) {
      case 'settled':
        return {
          paymentRecords: { some: { status: PaymentRecordStatus.SETTLED } },
          refunds: { none: { status: RefundStatus.APPLIED } },
        };
      case 'pending':
        return { status: OrderStatus.PENDING };
      case 'refunded':
        return { refunds: { some: { status: RefundStatus.APPLIED } } };
      case 'void':
        return { status: OrderStatus.VOID };
      case 'not_required':
        return { paymentRecords: { none: {} } };
      default:
        throw new BadRequestException('支付状态不正确');
    }
  }

  private presentOrder(order: OrderWithDetails) {
    const paidCents = order.paymentRecords
      .filter((payment) => payment.status === PaymentRecordStatus.SETTLED)
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const refundedCents = order.refunds
      .filter((refund) => refund.status === RefundStatus.APPLIED)
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const paymentStatus =
      refundedCents > 0
        ? refundedCents >= paidCents && paidCents > 0
          ? 'refunded'
          : 'partially_refunded'
        : order.paymentRecords.some(
              (payment) => payment.status === PaymentRecordStatus.SETTLED,
            )
          ? 'settled'
          : order.status === OrderStatus.PENDING
            ? 'pending'
            : order.status === OrderStatus.VOID
              ? 'void'
              : 'not_required';
    const productKind = order.catalogOffer?.product.kind
      ? order.catalogOffer.product.kind.toLowerCase()
      : order.kind === 'TRAFFIC_PACK'
        ? 'traffic_pack'
        : 'plan';
    return {
      id: order.id,
      user: order.user,
      product: {
        id: order.catalogOffer?.product.id ?? null,
        name:
          order.productNameSnapshot ??
          order.catalogOffer?.product.name ??
          order.kind.toLowerCase(),
        kind: productKind,
      },
      offer: order.catalogOffer
        ? {
            id: order.catalogOffer.id,
            name: order.catalogOffer.name,
            billingPeriod: order.catalogOffer.billingPeriod.toLowerCase(),
          }
        : null,
      source: order.source.toLowerCase(),
      fulfillmentStatus: order.status.toLowerCase(),
      paymentStatus,
      paymentType: order.epayPaymentAttempt?.paymentType ?? null,
      amountCents: order.amountCents,
      paidCents,
      refundedCents,
      currency: order.currency,
      merchantOrderNo: order.epayPaymentAttempt?.merchantOrderNo ?? null,
      gatewayTradeNo: order.epayPaymentAttempt?.gatewayTradeNo ?? null,
      createdAt: order.createdAt.toISOString(),
      processedAt: order.processedAt?.toISOString() ?? null,
    };
  }

  private presentAttempt(attempt: {
    id: string;
    orderId: string | null;
    merchantOrderNo: string;
    gatewayTradeNo: string | null;
    status: EpayPaymentStatus;
    paymentType: string;
    amountCents: number;
    productNameSnapshot: string;
    settlementFailureCount: number;
    lastSettlementError: string | null;
    lastSettlementFailedAt: Date | null;
    lastQueryAt: Date | null;
    queryFailureCount: number;
    lastQueryError: string | null;
    closedAt: Date | null;
    expiresAt: Date;
    settledAt: Date | null;
    failedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: attempt.id,
      orderId: attempt.orderId,
      merchantOrderNo: attempt.merchantOrderNo,
      gatewayTradeNo: attempt.gatewayTradeNo,
      status: attempt.status.toLowerCase(),
      paymentType: attempt.paymentType,
      amountCents: attempt.amountCents,
      productName: attempt.productNameSnapshot,
      fulfillmentPending:
        attempt.status !== EpayPaymentStatus.SETTLED &&
        attempt.settlementFailureCount > 0,
      settlementFailureCount: attempt.settlementFailureCount,
      lastSettlementError: attempt.lastSettlementError,
      lastSettlementFailedAt:
        attempt.lastSettlementFailedAt?.toISOString() ?? null,
      lastQueryAt: attempt.lastQueryAt?.toISOString() ?? null,
      queryFailureCount: attempt.queryFailureCount,
      lastQueryError: attempt.lastQueryError,
      closedAt: attempt.closedAt?.toISOString() ?? null,
      expiresAt: attempt.expiresAt.toISOString(),
      settledAt: attempt.settledAt?.toISOString() ?? null,
      failedAt: attempt.failedAt?.toISOString() ?? null,
      createdAt: attempt.createdAt.toISOString(),
      updatedAt: attempt.updatedAt.toISOString(),
    };
  }

  private dateRange(from?: string, to?: string) {
    if (!from && !to) return undefined;
    const fromDate = from ? this.shanghaiDate(from, '开始日期') : undefined;
    const toDate = to
      ? new Date(this.shanghaiDate(to, '结束日期').getTime() + DAY_MS)
      : undefined;
    if (fromDate && toDate && fromDate >= toDate) {
      throw new BadRequestException('日期范围不正确');
    }
    const range: Prisma.DateTimeFilter = {};
    if (fromDate) range.gte = fromDate;
    if (toDate) range.lt = toDate;
    return range;
  }

  private shanghaiDate(value: string, label: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${label}格式不正确`);
    }
    const date = new Date(`${value}T00:00:00+08:00`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label}格式不正确`);
    }
    return date;
  }

  private shanghaiStartOfDay(now: Date) {
    const parts = this.shanghaiParts(now);
    return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`);
  }

  private shanghaiStartOfMonth(now: Date) {
    const parts = this.shanghaiParts(now);
    return new Date(`${parts.year}-${parts.month}-01T00:00:00+08:00`);
  }

  private shanghaiParts(now: Date) {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(now)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    return values as { year: string; month: string; day: string };
  }

  private paymentType(value?: string) {
    if (!value) return undefined;
    if (value !== 'alipay' && value !== 'wxpay') {
      throw new BadRequestException('支付渠道不正确');
    }
    return value;
  }

  private enumValue<T extends Record<string, string>>(
    value: string | undefined,
    values: T,
    label: string,
  ): T[keyof T] | undefined {
    if (!value) return undefined;
    const normalized = value.toUpperCase();
    if (!Object.values(values).includes(normalized)) {
      throw new BadRequestException(`${label}不正确`);
    }
    return normalized as T[keyof T];
  }
}
