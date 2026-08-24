import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  async list(limit = 200) {
    const rows = await this.prisma.auditLog.findMany({
      include: { actor: { select: { email: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map((row) => ({
      ...row,
      actorEmail: row.actor?.email ?? null,
      actorDisplayName: row.actor?.displayName ?? null,
      actor: undefined,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  constructor(private readonly prisma: PrismaService) {}
}
