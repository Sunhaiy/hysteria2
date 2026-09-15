import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AgentUpdatesService } from './agent-updates.service';
import { SecretCipherService } from '../security/secret-cipher.service';
import {
  canReportUpdate,
  validateAgentArtifact,
} from './agent-update.contract';

const binary = () => {
  const b = Buffer.alloc(80);
  b.set([127, 69, 76, 70, 2, 1]);
  b.writeUInt16LE(62, 18);
  return b;
};
describe('Agent update contract', () => {
  it('accepts only the declared Linux architecture', () => {
    expect(() => validateAgentArtifact(binary(), 'amd64')).not.toThrow();
    expect(() => validateAgentArtifact(binary(), 'arm64')).toThrow();
    expect(() =>
      validateAgentArtifact(Buffer.from('not executable'), 'amd64'),
    ).toThrow();
  });
  it('rejects skipped stages and terminal status changes', () => {
    expect(canReportUpdate('DOWNLOADING', 'SUCCEEDED')).toBe(false);
    expect(canReportUpdate('SUCCEEDED', 'FAILED')).toBe(false);
    expect(canReportUpdate('SUCCEEDED', 'SUCCEEDED')).toBe(true);
    expect(canReportUpdate('INSTALLING', 'ROLLED_BACK')).toBe(true);
  });
});

const integration =
  process.env.AGENT_UPDATES_DATABASE_TEST === '1' ? describe : describe.skip;
integration('Agent updates PostgreSQL integration', () => {
  let db: PrismaClient;
  let admin: PrismaClient;
  let service: AgentUpdatesService;
  let release: Awaited<ReturnType<AgentUpdatesService['upload']>>;
  let a: Awaited<ReturnType<AgentUpdatesService['enroll']>>;
  let b: typeof a;
  const schema = `agent_updates_test_${randomUUID().replaceAll('-', '')}`;
  const heartbeat = {
    architecture: 'amd64',
    currentVersion: 'legacy',
    currentSha256: 'a'.repeat(64),
  };
  const oldKey = process.env.SETTINGS_ENCRYPTION_KEY;
  beforeAll(async () => {
    const env = parse(readFileSync(join(process.cwd(), '.env')));
    const url = new URL(env.DATABASE_URL);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('Tests require a local database');
    admin = new PrismaClient({ datasourceUrl: url.toString() });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    db = new PrismaClient({ datasourceUrl: url.toString() });
    for (const table of ['NodeServer', 'Setting', 'AuditLog']) {
      await db.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    await db.$executeRawUnsafe(
      `CREATE TYPE "${schema}"."AdminPermission" AS ENUM ('ADMIN_PERMISSIONS_MANAGE')`,
    );
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260915170000_agent_updates/migration.sql',
      ),
      'utf8',
    );
    for (const statement of sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.$executeRawUnsafe(statement);
    await db.$executeRawUnsafe(
      'CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "role" TEXT NOT NULL)',
    );
    await db.$executeRawUnsafe(
      'CREATE TABLE "AdminPermissionGrant" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "permission" "AdminPermission" NOT NULL, "createdAt" TIMESTAMP NOT NULL, UNIQUE("userId","permission"))',
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "User" VALUES ('existing-admin','ADMIN'),('existing-member','MEMBER')`,
    );
    const grantSql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260915170100_agent_update_permissions/migration.sql',
      ),
      'utf8',
    );
    await db.$executeRawUnsafe(grantSql);
    await db.$executeRawUnsafe(grantSql);
    const grants = await db.$queryRaw<
      Array<{ userId: string }>
    >`SELECT "userId" FROM "AdminPermissionGrant"`;
    expect(grants).toEqual([{ userId: 'existing-admin' }]);
    process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const cipher = new SecretCipherService();
    cipher.onModuleInit();
    service = new AgentUpdatesService(db as never, cipher);
    await db.nodeServer.createMany({
      data: [
        { id: 'server-a', slug: 'a', name: 'Canary', hostname: 'a.invalid' },
        { id: 'server-b', slug: 'b', name: 'Second', hostname: 'b.invalid' },
      ],
    });
  });
  beforeEach(async () => {
    await db.agentUpdateJob.deleteMany();
    await db.agentRollout.deleteMany();
    await db.agentInstallation.deleteMany();
    await db.agentRelease.deleteMany();
    release = await service.upload(
      { version: 'v1', architecture: 'amd64' },
      binary(),
      'admin',
    );
    a = await service.enroll(
      {
        serverId: 'server-a',
        serviceUnit: 'xray-agent.service',
        architecture: 'amd64',
      },
      'admin',
    );
    b = await service.enroll(
      {
        serverId: 'server-b',
        serviceUnit: 'xray-agent.service',
        architecture: 'amd64',
      },
      'admin',
    );
    await service.poll(a.id, heartbeat);
    await service.poll(b.id, heartbeat);
  });
  afterAll(async () => {
    if (oldKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = oldKey;
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
  const create = () =>
    service.createRollout(
      {
        releaseId: release.id,
        installationIds: [a.id, b.id],
        idempotencyKey: randomUUID(),
      },
      'admin',
    );
  const report = (id: string, status: string) =>
    service.report(a.id, id, {
      status,
      message: '',
      currentVersion: status === 'SUCCEEDED' ? release.version : 'legacy',
      currentSha256:
        status === 'SUCCEEDED' ? release.sha256 : heartbeat.currentSha256,
    });

  it('signs immutable artifacts and keeps credentials out of listings', async () => {
    expect(
      verify(
        null,
        Buffer.from(release.manifest),
        a.publicKey,
        Buffer.from(release.signature, 'base64'),
      ),
    ).toBe(true);
    await expect(
      service.upload(
        { version: 'v1', architecture: 'amd64' },
        binary(),
        'admin',
      ),
    ).rejects.toThrow('不可覆盖');
    expect(JSON.stringify(await service.overview())).not.toContain(a.token);
    const key = await db.setting.findUniqueOrThrow({
      where: { key: 'agentUpdates.signingKey' },
    });
    expect(key.value.startsWith('enc:v1:')).toBe(true);
    expect((await service.authenticate(`Bearer ${a.token}`)).id).toBe(a.id);
    await expect(service.authenticate('Bearer invalid')).rejects.toThrow();
  });
  it('binds retries to actor, release and ordered targets', async () => {
    const input = {
      releaseId: release.id,
      installationIds: [a.id, b.id],
      idempotencyKey: randomUUID(),
    };
    const first = await service.createRollout(input, 'admin');
    expect((await service.createRollout(input, 'admin')).id).toBe(first.id);
    await expect(
      service.createRollout(
        { ...input, installationIds: [b.id, a.id] },
        'admin',
      ),
    ).rejects.toThrow();
    await expect(service.createRollout(input, 'other')).rejects.toThrow();
    await expect(create()).rejects.toThrow('未完成');
  });
  it('serializes concurrent polls and advances only after canary success', async () => {
    await create();
    const [first, second] = await Promise.all([
      service.poll(a.id, heartbeat),
      service.poll(b.id, heartbeat),
    ]);
    expect(first.job).toBeTruthy();
    expect(second.job).toBeNull();
    expect((await service.poll(a.id, heartbeat)).job?.id).toBe(first.job!.id);
    const id = first.job!.id;
    await expect(service.artifact(b.id, id)).rejects.toThrow();
    await expect(
      service.report(b.id, id, { ...heartbeat, status: 'FAILED', message: '' }),
    ).rejects.toThrow();
    expect(Buffer.from((await service.artifact(a.id, id)).binary)).toEqual(
      binary(),
    );
    for (const status of ['VERIFYING', 'INSTALLING', 'CHECKING'])
      await report(id, status);
    await expect(
      service.report(a.id, id, {
        status: 'SUCCEEDED',
        message: '',
        currentVersion: 'wrong',
        currentSha256: release.sha256,
      }),
    ).rejects.toThrow();
    await report(id, 'SUCCEEDED');
    await report(id, 'SUCCEEDED');
    expect((await service.poll(b.id, heartbeat)).job).toBeTruthy();
    expect(
      await db.auditLog.count({
        where: { targetId: id, action: 'agent.update.result' },
      }),
    ).toBe(1);
  });
  it('holds the slot across disconnect and refuses stale installations', async () => {
    await create();
    await service.poll(a.id, heartbeat);
    await db.agentInstallation.update({
      where: { id: a.id },
      data: { lastSeenAt: new Date(0) },
    });
    expect((await service.poll(b.id, heartbeat)).job).toBeNull();
    await service.cancelRollout(
      (await db.agentRollout.findFirstOrThrow()).id,
      'admin',
    );
    await expect(
      service.createRollout(
        {
          releaseId: release.id,
          installationIds: [a.id],
          idempotencyKey: randomUUID(),
        },
        'admin',
      ),
    ).rejects.toThrow('在线');
  });
  it.each(['FAILED', 'ROLLED_BACK'])(
    'stops later nodes after %s',
    async (status) => {
      const rollout = await create();
      const claim = await service.poll(a.id, heartbeat);
      await report(claim.job!.id, status);
      expect(
        (await db.agentRollout.findUniqueOrThrow({ where: { id: rollout.id } }))
          .status,
      ).toBe('PAUSED');
      expect(
        (
          await db.agentUpdateJob.findFirstOrThrow({
            where: { installationId: b.id },
          })
        ).status,
      ).toBe('CANCELED');
      expect(
        await db.agentUpdateJob.count({ where: { activeKey: { not: null } } }),
      ).toBe(0);
    },
  );
  it('retains fleet slot while rollback needs another recovery attempt', async () => {
    await create();
    const claim = await service.poll(a.id, heartbeat);
    for (const status of ['VERIFYING', 'INSTALLING', 'ROLLING_BACK'])
      await report(claim.job!.id, status);
    expect((await service.poll(b.id, heartbeat)).job).toBeNull();
    expect((await service.poll(a.id, heartbeat)).job?.id).toBe(claim.job!.id);
    await report(claim.job!.id, 'ROLLED_BACK');
    expect(
      await db.agentUpdateJob.count({ where: { activeKey: { not: null } } }),
    ).toBe(0);
  });

  it('cancel leaves in-flight execution intact', async () => {
    const rollout = await create();
    const first = await service.poll(a.id, heartbeat);
    await service.cancelRollout(rollout.id, 'admin');
    expect((await service.poll(a.id, heartbeat)).job?.id).toBe(first.job!.id);
    expect((await service.poll(b.id, heartbeat)).job).toBeNull();
    for (const status of ['VERIFYING', 'INSTALLING', 'CHECKING', 'SUCCEEDED'])
      await report(first.job!.id, status);
    expect(
      (await db.agentRollout.findUniqueOrThrow({ where: { id: rollout.id } }))
        .status,
    ).toBe('CANCELED');
  });
});
