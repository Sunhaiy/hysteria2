import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeControlService } from '../domain/node-control.service';
import { HealthController } from './health.controller';

// Explicit loopback database, isolated schema; never load application credentials.
const databaseTests =
  process.env.NODE_SYNC_DATABASE_TEST === '1' ? describe : describe.skip;

databaseTests('Node synchronization health PostgreSQL integration', () => {
  const schema = `sync_health_test_${randomUUID().replaceAll('-', '')}`;
  let admin: PrismaClient;
  let db: PrismaClient;
  let nodes: NodeControlService;
  let health: HealthController;
  const savedSyncEnabled = process.env.NODE_SYNC_ENABLED;
  const savedUserSyncStaleSeconds = process.env.NODE_USER_SYNC_STALE_SECONDS;
  let migratedErrors: Array<{
    id: string;
    lastSyncError: string;
    lastUserSyncError: string | null;
    lastTrafficSyncError: string | null;
  }>;

  beforeAll(async () => {
    const url = new URL(process.env.NODE_SYNC_TEST_DATABASE_URL ?? '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Sync health tests require an isolated local database');
    }
    admin = new PrismaClient({ datasourceUrl: url.toString() });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    db = new PrismaClient({ datasourceUrl: url.toString() });
    await db.$executeRawUnsafe(
      `CREATE TYPE "NodeProtocol" AS ENUM ('HYSTERIA2', 'VLESS_REALITY')`,
    );
    await db.$executeRawUnsafe(`CREATE TABLE "Node" (
      "id" TEXT PRIMARY KEY, "active" BOOLEAN NOT NULL DEFAULT true,
      "protocol" "NodeProtocol" NOT NULL DEFAULT 'VLESS_REALITY',
      "lastSyncAt" TIMESTAMP(3), "lastSyncError" TEXT,
      "lastUserSyncAt" TIMESTAMP(3), "lastTrafficAt" TIMESTAMP(3),
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.$executeRawUnsafe(`INSERT INTO "Node" ("id", "protocol", "lastSyncError")
      VALUES ('legacy-vless', 'VLESS_REALITY', 'legacy failure'),
             ('legacy-hy2', 'HYSTERIA2', 'legacy failure')`);
    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20261117180000_node_sync_health/migration.sql',
      ),
      'utf8',
    );
    await db.$transaction(async (tx) => {
      for (const statement of migration
        .replace(/^--.*$/gm, '')
        .split(';')
        .map((value) => value.trim())
        .filter((value) => value && !/^(BEGIN|COMMIT)$/i.test(value))) {
        await tx.$executeRawUnsafe(statement);
      }
    });
    migratedErrors = await db.$queryRawUnsafe(`SELECT "id", "lastSyncError",
      "lastUserSyncError", "lastTrafficSyncError" FROM "Node" ORDER BY "id"`);
    await db.$executeRawUnsafe(
      `CREATE TYPE "UsageImportBatchStatus" AS ENUM ('APPLIED', 'ACKED')`,
    );
    await db.$executeRawUnsafe(`CREATE TABLE "UsageImportBatch" (
      "id" TEXT PRIMARY KEY, "status" "UsageImportBatchStatus" NOT NULL, "appliedAt" TIMESTAMP(3)
    )`);
    await db.$executeRawUnsafe(`CREATE TABLE "_prisma_migrations" (
      "finished_at" TIMESTAMPTZ, "rolled_back_at" TIMESTAMPTZ
    )`);
    // Selecting only the update result's id keeps the fixture schema focused on
    // sync health while retaining actual PostgreSQL UPDATE/count semantics.
    const prisma = {
      $executeRaw: db.$executeRaw.bind(db),
      $queryRaw: db.$queryRaw.bind(db),
      node: {
        update: (args: Parameters<typeof db.node.update>[0]) =>
          db.node.update({ ...args, select: { id: true } }),
        count: db.node.count.bind(db.node),
      },
      usageImportBatch: {
        count: db.usageImportBatch.count.bind(db.usageImportBatch),
      },
    };
    nodes = new NodeControlService(prisma as never, {} as never);
    health = new HealthController(
      prisma as never,
      { health: () => Promise.resolve({ ok: true }) } as never,
      { isConfigured: () => Promise.resolve(true) } as never,
    );
    process.env.NODE_SYNC_ENABLED = 'true';
    process.env.NODE_USER_SYNC_STALE_SECONDS = '600';
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe('DELETE FROM "Node"');
    await db.$executeRawUnsafe(`INSERT INTO "Node"
      ("id", "lastSyncAt", "lastTrafficAt", "lastUserSyncAt")
      VALUES ('vless', CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`);
  });

  afterAll(async () => {
    if (savedSyncEnabled === undefined) delete process.env.NODE_SYNC_ENABLED;
    else process.env.NODE_SYNC_ENABLED = savedSyncEnabled;
    if (savedUserSyncStaleSeconds === undefined)
      delete process.env.NODE_USER_SYNC_STALE_SECONDS;
    else process.env.NODE_USER_SYNC_STALE_SECONDS = savedUserSyncStaleSeconds;
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
      await admin.$disconnect();
    }
  });

  it('keeps failed user synchronization unhealthy after metering recovers', async () => {
    const scoped = nodes as unknown as {
      markSyncFailure: (
        id: string,
        cause: unknown,
        scope: 'users',
      ) => Promise<void>;
    };
    await scoped.markSyncFailure(
      'vless',
      new Error('user provisioning 503'),
      'users',
    );
    await nodes.markTrafficSyncSuccess('vless');

    await expect(health.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await nodes.markUserSyncSuccess('vless');
    await expect(health.getReadiness()).resolves.toMatchObject({ ok: true });
  });

  it('does not report fresh traffic as healthy when VLESS user sync is stale', async () => {
    await db.$executeRawUnsafe(`UPDATE "Node"
      SET "lastUserSyncAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '11 minutes'
      WHERE "id" = 'vless'`);

    await expect(health.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await nodes.markUserSyncSuccess('vless');
    await expect(health.getReadiness()).resolves.toMatchObject({ ok: true });
  });

  it('keeps metering failures unhealthy after user synchronization succeeds', async () => {
    await nodes.markSyncFailure(
      'vless',
      new Error('traffic unavailable'),
      'traffic',
    );
    await nodes.markUserSyncSuccess('vless');
    await expect(health.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await nodes.markTrafficSyncSuccess('vless');
    await expect(health.getReadiness()).resolves.toMatchObject({ ok: true });
  });

  it('preserves an independent failure when sync results arrive concurrently', async () => {
    await Promise.all([
      nodes.markTrafficSyncSuccess('vless'),
      nodes.markSyncFailure('vless', new Error('users unavailable'), 'users'),
    ]);
    await expect(health.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await Promise.all([
      nodes.markUserSyncSuccess('vless'),
      nodes.markSyncFailure(
        'vless',
        new Error('traffic unavailable'),
        'traffic',
      ),
    ]);
    await expect(health.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await nodes.markTrafficSyncSuccess('vless');
    await expect(health.getReadiness()).resolves.toMatchObject({ ok: true });
  });

  it('requires user sync for VLESS but not for native Hysteria authentication', async () => {
    await db.$executeRawUnsafe('UPDATE "Node" SET "lastUserSyncAt" = NULL');
    await expect(health.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await db.$executeRawUnsafe(`UPDATE "Node" SET "protocol" = 'HYSTERIA2'`);
    await expect(health.getReadiness()).resolves.toMatchObject({ ok: true });
  });

  it('conservatively preserves legacy sync failures during the additive migration', () => {
    expect(migratedErrors).toEqual([
      {
        id: 'legacy-hy2',
        lastSyncError: 'legacy failure',
        lastUserSyncError: null,
        lastTrafficSyncError: 'legacy failure',
      },
      {
        id: 'legacy-vless',
        lastSyncError: 'legacy failure',
        lastUserSyncError: 'legacy failure',
        lastTrafficSyncError: 'legacy failure',
      },
    ]);
  });
});
