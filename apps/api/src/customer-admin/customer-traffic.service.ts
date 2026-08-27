import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyTrafficQuery {
  from?: string;
  to?: string;
}

interface DailyTrafficRow {
  date: string;
  txBytes: bigint;
  rxBytes: bigint;
  physicalBytes: bigint;
  accountedBytes: bigint;
  multiplierBasisPoints: number | null;
  minMultiplierBasisPoints: number | null;
  maxMultiplierBasisPoints: number | null;
}

@Injectable()
export class CustomerTrafficService {
  constructor(private readonly prisma: PrismaService) {}

  async daily(userId: string, query: DailyTrafficQuery, now = new Date()) {
    const to = query.to ?? this.shanghaiDateKey(now);
    const from = query.from ?? this.shiftDateKey(to, -6);
    this.requireDateKey(from);
    this.requireDateKey(to);
    const fromDate = this.startOfShanghaiDate(from);
    const toExclusive = this.startOfShanghaiDate(this.shiftDateKey(to, 1));
    const days = Math.round(
      (toExclusive.getTime() - fromDate.getTime()) / DAY_MS,
    );
    if (days < 1 || days > 366) {
      throw new BadRequestException('Traffic date range must be 1 to 366 days');
    }

    const rows = await this.prisma.$queryRaw<DailyTrafficRow[]>(Prisma.sql`
      SELECT
        to_char(
          rollup."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai',
          'YYYY-MM-DD'
        ) AS date,
        COALESCE(SUM(rollup."txBytes"), 0)::bigint AS "txBytes",
        COALESCE(SUM(rollup."rxBytes"), 0)::bigint AS "rxBytes",
        COALESCE(SUM(rollup."txBytes" + rollup."rxBytes"), 0)::bigint AS "physicalBytes",
        COALESCE(SUM(COALESCE(
          rollup."accountedBytes", rollup."txBytes" + rollup."rxBytes"
        )), 0)::bigint AS "accountedBytes",
        ROUND(
          COALESCE(SUM(COALESCE(
            rollup."accountedBytes", rollup."txBytes" + rollup."rxBytes"
          )), 0) * 10000.0 /
          NULLIF(COALESCE(SUM(rollup."txBytes" + rollup."rxBytes"), 0), 0)
        )::integer AS "multiplierBasisPoints",
        MIN(COALESCE(rollup."multiplierBasisPoints", 10000))::integer
          AS "minMultiplierBasisPoints",
        MAX(COALESCE(rollup."multiplierBasisPoints", 10000))::integer
          AS "maxMultiplierBasisPoints"
      FROM "UsageRollup" rollup
      WHERE rollup."userId" = ${userId}
        AND rollup."bucketStart" >= ${fromDate}
        AND rollup."bucketStart" < ${toExclusive}
      GROUP BY to_char(
        rollup."bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai',
        'YYYY-MM-DD'
      )
      ORDER BY date ASC
    `);

    const byDate = new Map(rows.map((row) => [row.date, row]));
    const items = Array.from({ length: days }, (_, index) => {
      const date = this.shiftDateKey(from, index);
      const row = byDate.get(date);
      return {
        date,
        txBytes: Number(row?.txBytes ?? 0n),
        rxBytes: Number(row?.rxBytes ?? 0n),
        physicalBytes: Number(row?.physicalBytes ?? 0n),
        accountedBytes: Number(row?.accountedBytes ?? 0n),
        actualMultiplier:
          row?.multiplierBasisPoints == null
            ? null
            : row.multiplierBasisPoints / 10_000,
        minMultiplier:
          row?.minMultiplierBasisPoints == null
            ? null
            : row.minMultiplierBasisPoints / 10_000,
        maxMultiplier:
          row?.maxMultiplierBasisPoints == null
            ? null
            : row.maxMultiplierBasisPoints / 10_000,
      };
    });
    return {
      timezone: 'Asia/Shanghai',
      from,
      to,
      totals: {
        txBytes: items.reduce((sum, item) => sum + item.txBytes, 0),
        rxBytes: items.reduce((sum, item) => sum + item.rxBytes, 0),
        physicalBytes: items.reduce((sum, item) => sum + item.physicalBytes, 0),
        accountedBytes: items.reduce(
          (sum, item) => sum + item.accountedBytes,
          0,
        ),
      },
      items,
    };
  }

  private requireDateKey(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Traffic dates must use YYYY-MM-DD');
    }
    const [year, month, day] = value.split('-').map(Number);
    const normalized = new Date(Date.UTC(year, month - 1, day))
      .toISOString()
      .slice(0, 10);
    if (normalized !== value)
      throw new BadRequestException('Invalid traffic date');
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
