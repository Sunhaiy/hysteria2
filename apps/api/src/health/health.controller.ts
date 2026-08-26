import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { apiPublicUrl, webPublicUrl } from '../common/public-url';

@Controller('api/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly mail: MailService,
  ) {}

  @Get()
  readiness() {
    return this.getReadiness();
  }

  @Get('live')
  liveness() {
    return { ok: true, timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async getReadiness() {
    const timestamp = new Date().toISOString();
    const publicUrls = this.publicUrlHealth();
    const [database, redis, migrations, nodes, mail] = await Promise.all([
      this.databaseHealth(),
      this.cache.health(),
      this.migrationHealth(),
      this.nodeSyncHealth(),
      this.mailHealth(),
    ]);
    const checks = { database, redis, migrations, nodes, mail, publicUrls };
    const ok = Object.values(checks).every((check) => check.ok);
    const payload = { ok, timestamp, checks };
    if (!ok) throw new ServiceUnavailableException(payload);
    return payload;
  }

  private async databaseHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error) };
    }
  }

  private async migrationHealth() {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
      `;
      const incomplete = Number(rows[0]?.count ?? 0);
      return { ok: incomplete === 0, incomplete };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error) };
    }
  }

  private async nodeSyncHealth() {
    const enabled =
      process.env.NODE_SYNC_ENABLED === 'true' ||
      process.env.HYSTERIA_SYNC_ENABLED === 'true';
    if (!enabled)
      return { ok: true, enabled: false, staleNodes: 0, pendingBatches: 0 };

    try {
      const staleSeconds = Math.max(
        Number(process.env.NODE_SYNC_STALE_SECONDS ?? 180),
        60,
      );
      const staleBefore = new Date(Date.now() - staleSeconds * 1000);
      const pendingBefore = new Date(Date.now() - staleSeconds * 1000);
      const [staleNodes, pendingBatches] = await Promise.all([
        this.prisma.node.count({
          where: {
            active: true,
            OR: [
              { lastSyncAt: null },
              { lastSyncAt: { lt: staleBefore } },
              { lastSyncError: { not: null } },
            ],
          },
        }),
        this.prisma.usageImportBatch.count({
          where: { status: 'APPLIED', appliedAt: { lt: pendingBefore } },
        }),
      ]);
      return {
        ok: staleNodes === 0 && pendingBatches === 0,
        enabled: true,
        staleNodes,
        pendingBatches,
      };
    } catch (error) {
      return { ok: false, enabled: true, error: this.errorMessage(error) };
    }
  }

  private async mailHealth() {
    try {
      const configured = await this.mail.isConfigured();
      const required = process.env.SMTP_REQUIRED === 'true';
      return { ok: !required || configured, configured, required };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error) };
    }
  }

  private publicUrlHealth() {
    try {
      return { ok: true, api: apiPublicUrl(), web: webPublicUrl() };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error) };
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
