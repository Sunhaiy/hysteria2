import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { HysteriaAuthTelemetryService } from './hysteria-auth-telemetry.service';

const databaseTests =
  process.env.AUTH_TELEMETRY_DATABASE_TEST === '1' ? describe : describe.skip;

databaseTests('Hysteria auth observations with PostgreSQL', () => {
  const schema = `auth_telemetry_test_${randomUUID().replaceAll('-', '')}`;
  let admin: PrismaClient;
  let database: PrismaClient;

  beforeAll(async () => {
    const url = new URL(process.env.AUTH_TELEMETRY_TEST_DATABASE_URL ?? '');
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
      throw new Error(
        'Authentication telemetry tests require a local database',
      );
    }
    admin = new PrismaClient({ datasourceUrl: url.toString() });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    database = new PrismaClient({ datasourceUrl: url.toString() });
    await database.$executeRawUnsafe(`CREATE TABLE "AccessToken" (
      id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, label TEXT NOT NULL,
      token TEXT NOT NULL, "vlessUuid" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastUsedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3)
    )`);
    await database.$executeRawUnsafe(`CREATE TABLE "AuthEvent" (
      id TEXT PRIMARY KEY, "userId" TEXT, "accessTokenId" TEXT, "nodeId" TEXT,
      granted BOOLEAN NOT NULL, reason TEXT NOT NULL, "remoteAddr" TEXT,
      "requestedTxBps" INTEGER, "submittedTokenPreview" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await database.accessToken.create({
      data: {
        id: 'test-token',
        userId: 'test-user',
        label: 'test',
        token: 'isolated-fixture',
      },
    });
  });

  afterAll(async () => {
    await database?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
      await admin.$disconnect();
    }
  });

  it('ends optional database work before a held token row lock is released', async () => {
    let release!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const lockingTransaction = database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AccessToken" WHERE id = 'test-token' FOR UPDATE`;
      locked();
      await hold;
    });
    await acquired;
    const telemetry = new HysteriaAuthTelemetryService(database as never);
    let timer: NodeJS.Timeout | undefined;
    try {
      telemetry.record({
        accessTokenId: 'test-token',
        userId: 'test-user',
        granted: true,
        reason: 'ok',
      });
      await expect(
        Promise.race([
          telemetry.onModuleDestroy().then(() => 'finished'),
          new Promise<string>((resolve) => {
            timer = setTimeout(() => resolve('still holding connection'), 500);
          }),
        ]),
      ).resolves.toBe('finished');
      expect(await database.authEvent.count()).toBe(0);
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await lockingTransaction;
      await telemetry.onModuleDestroy();
    }
  });

  it('can persist a later observation after the contended write was abandoned', async () => {
    const telemetry = new HysteriaAuthTelemetryService(database as never);
    telemetry.record({
      accessTokenId: 'test-token',
      userId: 'test-user',
      granted: true,
      reason: 'after-lock-release',
    });
    await telemetry.onModuleDestroy();
    expect(
      await database.authEvent.count({
        where: { reason: 'after-lock-release', granted: true },
      }),
    ).toBe(1);
    expect(
      (
        await database.accessToken.findUniqueOrThrow({
          where: { id: 'test-token' },
        })
      ).lastUsedAt,
    ).not.toBeNull();
  });
});
