import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';

export interface AuditQuery extends PageQuery {
  q?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async record(input: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    remoteAddr?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }) {
    try {
      await this.prisma.auditLog.create({ data: input });
    } catch (error) {
      this.logger.error(`Failed to persist audit log: ${String(error)}`);
    }
  }

  async list(query: AuditQuery) {
    const { page, pageSize, skip } = parsePage(query);
    const q = query.q?.trim();
    const where = q
      ? {
          OR: [
            { action: { contains: q, mode: 'insensitive' as const } },
            { targetType: { contains: q, mode: 'insensitive' as const } },
            { targetId: { contains: q, mode: 'insensitive' as const } },
            { actor: { email: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { email: true, displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return pageResponse(
      rows.map((row) => ({
        ...row,
        actorEmail: row.actor?.email ?? null,
        actorDisplayName: row.actor?.displayName ?? null,
        actor: undefined,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  constructor(private readonly prisma: PrismaService) {}
}
