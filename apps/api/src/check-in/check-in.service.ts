import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  CatalogProductSeries,
  EntitlementGrantKind,
  EntitlementGrantStatus,
  Prisma,
} from '@prisma/client';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  goPlanActivityExclusionWhere,
  isGoPlanProduct,
} from '../catalog/catalog-product-policy';

const GIB = 1024 ** 3;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface AdminCheckInQuery extends PageQuery {
  q?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly entitlements: EntitlementService,
  ) {}

  async getToday(userId: string, now = new Date()) {
    const [config, claimed, eligible] = await Promise.all([
      this.settings.getDailyCheckInConfig(),
      this.prisma.dailyCheckIn.findUnique({
        where: {
          userId_businessDate: {
            userId,
            businessDate: this.businessDate(now),
          },
        },
      }),
      this.findEligibleGrant(this.prisma, userId, now),
    ]);
    return this.presentStatus(
      config,
      eligible !== null,
      claimed,
      false,
      this.dateKey(now),
    );
  }

  async claim(userId: string, now = new Date()) {
    const config = await this.settings.getDailyCheckInConfig();
    if (!config.enabled || config.rewardBytes <= 0) {
      throw new BadRequestException('每日签到当前未开放');
    }
    const businessDate = this.businessDate(now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.dailyCheckIn.findUnique({
              where: { userId_businessDate: { userId, businessDate } },
            });
            if (existing) {
              return this.presentStatus(
                config,
                true,
                existing,
                true,
                this.dateKey(now),
              );
            }
            const eligible = await this.findEligibleGrant(tx, userId, now);
            if (!eligible) {
              throw new BadRequestException('仅当前有效的订阅用户可签到');
            }
            const rewardBytes = BigInt(config.rewardBytes);
            const credit = await this.entitlements.creditQuotaBucket(tx, {
              bucketId: eligible.bucket.id,
              bytes: rewardBytes,
              at: now,
              idempotencyKey: `daily-check-in:${userId}:${this.dateKey(now)}`,
              reason: '每日签到奖励',
            });
            const claimed = await tx.dailyCheckIn.create({
              data: {
                userId,
                businessDate,
                rewardBytes,
                entitlementGrantId: eligible.id,
                quotaBucketId: eligible.bucket.id,
                subscriptionCycleId: credit.subscriptionCycleId,
                quotaAdjustmentId: credit.adjustmentId,
                claimedAt: now,
              },
            });
            await tx.auditLog.create({
              data: {
                action: 'daily_check_in.claimed',
                targetType: 'daily_check_in',
                targetId: claimed.id,
                metadata: {
                  userId,
                  businessDate: this.dateKey(now),
                  rewardBytes: rewardBytes.toString(),
                  grantId: eligible.id,
                  bucketId: eligible.bucket.id,
                },
              },
            });
            return this.presentStatus(
              config,
              true,
              claimed,
              false,
              this.dateKey(now),
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (this.isRetryable(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('签到领取冲突，请重试');
  }

  async getAdminSettings() {
    const [config, today, month] = await Promise.all([
      this.settings.getDailyCheckInConfig(),
      this.prisma.dailyCheckIn.aggregate({
        where: { businessDate: this.businessDate(new Date()) },
        _count: { _all: true },
        _sum: { rewardBytes: true },
      }),
      this.prisma.dailyCheckIn.aggregate({
        where: { businessDate: { gte: this.monthStart(new Date()) } },
        _count: { _all: true },
        _sum: { rewardBytes: true },
      }),
    ]);
    return {
      enabled: config.enabled,
      rewardGiB: config.rewardBytes / GIB,
      todayClaims: today._count._all,
      todayRewardBytes: Number(today._sum.rewardBytes ?? BigInt(0)),
      monthClaims: month._count._all,
      monthRewardBytes: Number(month._sum.rewardBytes ?? BigInt(0)),
    };
  }

  async updateAdminSettings(
    input: { enabled: boolean; rewardGiB: number },
    actorId: string,
  ) {
    if (input.enabled && input.rewardGiB <= 0) {
      throw new BadRequestException('开启签到时每日奖励必须大于 0 GiB');
    }
    const rewardBytes = Math.round(input.rewardGiB * GIB);
    await this.settings.setMany({
      'dailyCheckIn.enabled': String(input.enabled),
      'dailyCheckIn.rewardBytes': String(rewardBytes),
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'daily_check_in.settings_updated',
        targetType: 'daily_check_in_settings',
        metadata: { enabled: input.enabled, rewardBytes: String(rewardBytes) },
      },
    });
    return this.getAdminSettings();
  }

  async listAdmin(query: AdminCheckInQuery) {
    const { page, pageSize, skip } = parsePage(query, {
      defaultPageSize: 20,
      maxPageSize: 100,
    });
    const q = query.q?.trim();
    const where: Prisma.DailyCheckInWhereInput = {
      user: q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      businessDate: this.dateRange(query.from, query.to),
    };
    const [items, total] = await Promise.all([
      this.prisma.dailyCheckIn.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
          entitlementGrant: {
            select: { product: { select: { name: true } } },
          },
        },
        orderBy: [{ claimedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.dailyCheckIn.count({ where }),
    ]);
    return pageResponse(
      items.map((item) => ({
        id: item.id,
        userId: item.userId,
        userEmail: item.user.email,
        userDisplayName: item.user.displayName,
        productName: item.entitlementGrant.product.name,
        businessDate: item.businessDate.toISOString().slice(0, 10),
        rewardBytes: Number(item.rewardBytes),
        claimedAt: item.claimedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  private async findEligibleGrant(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
    now: Date,
  ) {
    const grant = await client.entitlementGrant.findFirst({
      where: {
        userId,
        kind: EntitlementGrantKind.PLAN,
        status: EntitlementGrantStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gt: now },
        product: {
          series: {
            in: [CatalogProductSeries.STANDARD, CatalogProductSeries.ULTRA],
          },
          NOT: goPlanActivityExclusionWhere,
        },
      },
      include: {
        product: {
          select: {
            series: true,
            slug: true,
            purchaseLimitKey: true,
            legacyPlan: { select: { slug: true } },
          },
        },
        quotaBuckets: {
          where: { startsAt: { lte: now }, endsAt: { gt: now } },
          orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    });
    const bucket = grant?.quotaBuckets[0];
    if (!grant || !bucket || isGoPlanProduct(grant.product)) return null;
    return {
      ...grant,
      bucket,
    };
  }

  private presentStatus(
    config: { enabled: boolean; rewardBytes: number },
    eligible: boolean,
    claimed: { id: string; rewardBytes: bigint; claimedAt: Date } | null,
    replayed: boolean,
    businessDate: string,
  ) {
    return {
      enabled: config.enabled,
      eligible,
      claimable: config.enabled && eligible && !claimed,
      claimed: Boolean(claimed),
      rewardBytes: claimed ? Number(claimed.rewardBytes) : config.rewardBytes,
      claimedAt: claimed?.claimedAt.toISOString() ?? null,
      checkInId: claimed?.id ?? null,
      replayed,
      businessDate,
      timezone: 'Asia/Shanghai',
    };
  }

  private dateKey(now: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  private businessDate(now: Date) {
    const [year, month, day] = this.dateKey(now).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private monthStart(now: Date) {
    const shanghai = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
    return new Date(
      Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), 1),
    );
  }

  private dateRange(from?: string, to?: string) {
    if (!from && !to) return undefined;
    const parse = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException('日期格式必须为 YYYY-MM-DD');
      }
      return new Date(`${value}T00:00:00.000Z`);
    };
    const start = from ? parse(from) : undefined;
    const end = to ? parse(to) : undefined;
    return { gte: start, lte: end };
  }

  private isRetryable(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'P2002' || error.code === 'P2034')
    );
  }
}
