import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { QuotaEnforcementService } from './quota-enforcement.service';

// These tests exercise PostgreSQL's actual claim/lease semantics in an isolated
// schema, never the application tables. Opt in explicitly for local validation.
const databaseTests =
  process.env.QUOTA_DATABASE_TEST === '1' ? describe : describe.skip;
databaseTests('QuotaEnforcementService PostgreSQL integration', () => {
  let db: PrismaClient;
  let admin: PrismaClient;
  const schema = `quota_test_${randomUUID().replaceAll('-', '')}`;
  const access = jest.fn();
  const kick = jest.fn<
    Promise<{ kicked: number }>,
    [{ id: string }, string[]]
  >();
  const node = { id: 'new-node', active: true, protocol: 'hysteria2' };
  let service: QuotaEnforcementService;
  const makeService = () =>
    new QuotaEnforcementService(
      {
        nodeAccessRevocation: db.nodeAccessRevocation,
        node: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'new-node' }, { id: 'pack-node' }]),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      } as never,
      {
        getNodeForControl: jest.fn((id: string) => ({ ...node, id })),
      } as never,
      { getNodeAccess: access } as never,
      { kickUsers: kick } as never,
    );

  beforeAll(async () => {
    const env = parse(readFileSync(join(process.cwd(), '.env')));
    const url = new URL(
      process.env.QUOTA_TEST_DATABASE_URL ?? env.DATABASE_URL,
    );
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
      throw new Error('Quota integration tests require a local database');
    }
    admin = new PrismaClient({ datasourceUrl: url.toString() });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    db = new PrismaClient({ datasourceUrl: url.toString() });
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260915150000_node_access_revocation/migration.sql',
      ),
      'utf8',
    );
    for (const statement of sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
  });
  beforeEach(async () => {
    await db.nodeAccessRevocation.deleteMany();
    access.mockReset().mockResolvedValue({ allowed: false });
    kick.mockReset().mockResolvedValue({ kicked: 1 });
    service = makeService();
  });
  afterAll(async () => {
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });

  it('covers new nodes and pack-only users without a legacy subscription', async () => {
    await service.enqueue('pack-only-user', 'new-node');
    await service.processDue();
    expect(kick.mock.calls.map(([n]) => n.id).sort()).toEqual([
      'new-node',
      'pack-node',
    ]);
    expect(
      await db.nodeAccessRevocation.count({ where: { status: 'SUCCEEDED' } }),
    ).toBe(2);
  });
  it('preserves a different node on which a pack still grants access', async () => {
    access.mockImplementation((_user: string, id: string) => ({
      allowed: id === 'pack-node',
    }));
    await service.enqueue('user', 'new-node');
    await service.processDue();
    expect(kick).toHaveBeenCalledTimes(1);
    expect(kick.mock.calls[0][0].id).toBe('new-node');
    expect(
      await db.nodeAccessRevocation.count({ where: { status: 'CANCELED' } }),
    ).toBe(1);
  });
  it('persists a failure, survives restart and cancels after renewal before retry', async () => {
    kick.mockRejectedValue(new Error('gateway unavailable'));
    await service.enqueue('user', 'new-node');
    await service.processDue();
    const pending = await db.nodeAccessRevocation.findMany();
    expect(
      pending.every(
        (t) => t.status === 'PENDING' && t.attempts === 1 && t.lastError,
      ),
    ).toBe(true);
    await service.enqueue('user', 'new-node');
    expect(
      (await db.nodeAccessRevocation.findMany()).map((t) => t.nextAttemptAt),
    ).toEqual(pending.map((t) => t.nextAttemptAt));
    access.mockResolvedValue({ allowed: true });
    kick.mockClear();
    await db.nodeAccessRevocation.updateMany({
      data: { nextAttemptAt: new Date(0) },
    });
    await makeService().processDue();
    expect(kick).not.toHaveBeenCalled();
    expect(
      await db.nodeAccessRevocation.count({ where: { status: 'CANCELED' } }),
    ).toBe(2);
  });
  it('retries until actual disconnection succeeds without a new traffic batch', async () => {
    kick.mockRejectedValueOnce(new Error('timeout'));
    await service.enqueue('user', 'new-node');
    await service.processDue();
    expect(
      await db.nodeAccessRevocation.count({ where: { status: 'PENDING' } }),
    ).toBe(1);
    await db.nodeAccessRevocation.updateMany({
      data: { nextAttemptAt: new Date(0) },
    });
    await makeService().processDue();
    expect(
      await db.nodeAccessRevocation.count({ where: { status: 'SUCCEEDED' } }),
    ).toBe(2);
  });
  it('only one concurrent worker claims each task', async () => {
    await service.enqueue('user', 'new-node');
    await Promise.all([service.processDue(), makeService().processDue()]);
    expect(kick).toHaveBeenCalledTimes(2);
    expect(
      (await db.nodeAccessRevocation.findMany()).every((t) => t.attempts === 1),
    ).toBe(true);
  });
  it('recovers expired leases but does not steal live leases', async () => {
    await service.enqueue('user', 'new-node');
    await db.nodeAccessRevocation.updateMany({
      where: { nodeId: 'new-node' },
      data: {
        status: 'RUNNING',
        leaseToken: 'crashed-worker',
        leaseUntil: new Date(0),
      },
    });
    await db.nodeAccessRevocation.updateMany({
      where: { nodeId: 'pack-node' },
      data: {
        status: 'RUNNING',
        leaseToken: 'live-worker',
        leaseUntil: new Date(Date.now() + 120_000),
      },
    });
    await service.processDue();
    expect(kick).toHaveBeenCalledTimes(1);
    expect(kick.mock.calls[0][0].id).toBe('new-node');
  });
  it('serializes provisioning and revocation on the same node', async () => {
    await service.enqueue('user', 'new-node');
    let release!: () => void;
    const lock = service.withNodeLock(
      'new-node',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const run = service.processDue();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(kick.mock.calls.some(([n]) => n.id === 'new-node')).toBe(false);
    access.mockResolvedValue({ allowed: true });
    release();
    await lock;
    await run;
    expect(kick.mock.calls.some(([n]) => n.id === 'new-node')).toBe(false);
  });
});
