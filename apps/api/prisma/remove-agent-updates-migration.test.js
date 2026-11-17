const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const databaseUrl = process.env.RETIREMENT_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
if (enabled && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Retirement migration tests require an isolated local database');
}
const psql = process.env.PSQL_BIN || 'psql';
const sql = fs.readFileSync(path.join(__dirname, 'migrations/20261116120000_remove_agent_updates/migration.sql'), 'utf8');
const args = () => [databaseUrl, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
const execute = input => execFileSync(psql, args(), { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
function fixture() {
  const schema = 'retirement_test_' + randomUUID().replaceAll('-', '');
  const prefix = `SET search_path TO "${schema}";\n`;
  execute(`CREATE SCHEMA "${schema}";${prefix}
    CREATE TABLE "Node" (id TEXT PRIMARY KEY, marker TEXT NOT NULL);
    INSERT INTO "Node" VALUES ('serving-node', 'unchanged');
    CREATE TABLE "AgentRelease" (id TEXT PRIMARY KEY);
    CREATE TABLE "AgentInstallation" (id TEXT PRIMARY KEY);
    CREATE TABLE "AgentRollout" (id TEXT PRIMARY KEY, "releaseId" TEXT REFERENCES "AgentRelease", status TEXT NOT NULL);
    CREATE TABLE "AgentUpdateJob" (id TEXT PRIMARY KEY, "rolloutId" TEXT REFERENCES "AgentRollout", "installationId" TEXT REFERENCES "AgentInstallation", status TEXT NOT NULL, "activeKey" TEXT);
    CREATE TABLE "Setting" (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO "Setting" VALUES ('agentUpdates.signingKey','fixture'), ('unrelated','preserved');
    CREATE TYPE "AdminPermission" AS ENUM ('DESTINATION_AUDIT_READ','ADMIN_PERMISSIONS_MANAGE','SEO_CONTENT_MANAGE','AGENT_UPDATES_MANAGE');
    CREATE TABLE "AdminPermissionGrant" (id TEXT PRIMARY KEY, permission "AdminPermission" NOT NULL);
    INSERT INTO "AdminPermissionGrant" VALUES ('old','AGENT_UPDATES_MANAGE'),('seo','SEO_CONTENT_MANAGE');
    INSERT INTO "AgentRelease" VALUES ('release');
    INSERT INTO "AgentInstallation" VALUES ('installation');
    INSERT INTO "AgentRollout" VALUES ('rollout','release','SUCCEEDED');
    INSERT INTO "AgentUpdateJob" VALUES ('job','rollout','installation','SUCCEEDED',NULL);
  `);
  return { schema, prefix, run: command => execute(prefix + command), cleanup: () => execute(`DROP SCHEMA "${schema}" CASCADE;`) };
}

test('contract refuses unfinished work and rolls back all removals', { skip: !enabled }, () => {
  const f = fixture();
  try {
    f.run(`UPDATE "AgentUpdateJob" SET status='INSTALLING', "activeKey"='installation';`);
    assert.throws(() => f.run(sql), /unfinished update jobs/);
    assert.equal(f.run('SELECT COUNT(*) FROM "AgentUpdateJob";'), '1');
    assert.equal(f.run('SELECT permission::text FROM "AdminPermissionGrant" WHERE id=\'old\';'), 'AGENT_UPDATES_MANAGE');
    assert.equal(f.run('SELECT value FROM "Setting" WHERE key=\'agentUpdates.signingKey\';'), 'fixture');
  } finally { f.cleanup(); }
});

test('contract removes updater objects and retains serving data and supported grants', { skip: !enabled }, () => {
  const f = fixture();
  try {
    f.run(sql);
    assert.equal(f.run(`SELECT to_regclass('"AgentUpdateJob"') IS NULL AND to_regclass('"AgentRollout"') IS NULL AND to_regclass('"AgentInstallation"') IS NULL AND to_regclass('"AgentRelease"') IS NULL;`), 't');
    assert.equal(f.run('SELECT COUNT(*) FROM "Setting" WHERE key=\'agentUpdates.signingKey\';'), '0');
    assert.equal(f.run('SELECT permission::text FROM "AdminPermissionGrant";'), 'SEO_CONTENT_MANAGE');
    assert.equal(f.run('SELECT marker FROM "Node" WHERE id=\'serving-node\';'), 'unchanged');
    assert.equal(f.run('SELECT cardinality(enum_range(NULL::"AdminPermission"));'), '3');
  } finally { f.cleanup(); }
});

test('contract times out on an updater advisory lock without deleting anything', { skip: !enabled }, async () => {
  const f = fixture();
  const holder = spawn(psql, args(), { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const deadline = setTimeout(() => reject(new Error('Lock fixture did not start')), 5000);
      holder.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('LOCK_ACQUIRED')) { clearTimeout(deadline); resolve(); }
      });
      holder.on('error', error => { clearTimeout(deadline); reject(error); });
      holder.stdin.end("SELECT pg_advisory_lock(7419230);SELECT 'LOCK_ACQUIRED';SELECT pg_sleep(4);");
    });
    assert.throws(() => f.run(sql), /lock timeout/);
    assert.equal(f.run('SELECT COUNT(*) FROM "AgentUpdateJob";'), '1');
    assert.equal(f.run('SELECT marker FROM "Node";'), 'unchanged');
  } finally {
    holder.kill();
    f.cleanup();
  }
});

test('candidate Prisma permission reads remain usable across enum contraction', { skip: !enabled }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const f = fixture();
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', f.schema);
  url.searchParams.set('connection_limit', '1');
  const client = new PrismaClient({ datasourceUrl: url.toString() });
  const read = () => client.adminPermissionGrant.findMany({
    where: { permission: { in: ['SEO_CONTENT_MANAGE'] } },
    select: { permission: true },
  });
  try {
    assert.deepEqual(await read(), [{ permission: 'SEO_CONTENT_MANAGE' }]);
    f.run(sql);
    assert.deepEqual(await read(), [{ permission: 'SEO_CONTENT_MANAGE' }]);
  } finally {
    await client.$disconnect();
    f.cleanup();
  }
});
