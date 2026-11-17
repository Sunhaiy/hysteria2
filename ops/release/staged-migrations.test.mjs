import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertOldProcessesDrained, main, prepareExpandSchema, retirementMigration } from './staged-migrations.mjs';

test('expand applies unchanged earlier and later SQL while deferring only the destructive contract', () => {
  const release = mkdtempSync(join(tmpdir(), 'staged-release-test-'));
  let staged;
  try {
    const prisma = join(release, 'apps/api/prisma');
    mkdirSync(join(prisma, 'migrations'), { recursive: true });
    writeFileSync(join(prisma, 'schema.prisma'), 'datasource db {}');
    for (const name of ['20260101000000_initial', retirementMigration, '20261117120000_sync_health']) {
      mkdirSync(join(prisma, 'migrations', name));
      writeFileSync(join(prisma, 'migrations', name, 'migration.sql'), `-- exact ${name}\nSELECT 1;\n`);
    }
    writeFileSync(join(prisma, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
    staged = prepareExpandSchema(release);
    assert.deepEqual(readdirSync(join(staged, 'migrations')).sort(), ['20260101000000_initial', '20261117120000_sync_health', 'migration_lock.toml']);
    assert.equal(readFileSync(join(staged, 'migrations', '20261117120000_sync_health', 'migration.sql'), 'utf8'), '-- exact 20261117120000_sync_health\nSELECT 1;\n');
    assert.equal(readFileSync(join(prisma, 'migrations', retirementMigration, 'migration.sql'), 'utf8'), `-- exact ${retirementMigration}\nSELECT 1;\n`);
  } finally {
    if (staged) rmSync(staged, { recursive: true, force: true });
    rmSync(release, { recursive: true, force: true });
  }
});

test('contract refuses a still-running old process', () => {
  const old = [{ role: 'api', pid: 101 }, { role: 'web', pid: 102 }, { role: 'worker', pid: 103 }];
  assert.throws(() => assertOldProcessesDrained(old, pid => pid === 101), /still running/);
  assert.doesNotThrow(() => assertOldProcessesDrained(old, () => false));
});

test('contract requires all three distinct old process identities', () => {
  assert.throws(() => assertOldProcessesDrained([], () => false), /old api, web and worker/);
  assert.throws(() => assertOldProcessesDrained([{ role: 'api', pid: 101 }, { role: 'web', pid: 101 }, { role: 'worker', pid: 103 }], () => false), /distinct/);
});

test('expand runs outside a release config that pins the full migration directory', () => {
  const release = mkdtempSync(join(tmpdir(), 'staged-config-test-'));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    const api = join(release, 'apps/api');
    const prisma = join(api, 'prisma');
    mkdirSync(join(prisma, 'migrations', retirementMigration), { recursive: true });
    writeFileSync(join(api, 'package.json'), '{}');
    writeFileSync(join(api, 'prisma.config.ts'), '/* pins full migrations.path */');
    writeFileSync(join(prisma, 'schema.prisma'), 'datasource db {}');
    writeFileSync(join(prisma, 'migrations', retirementMigration, 'migration.sql'), 'DROP TABLE retired;');
    mkdirSync(join(prisma, 'migrations', '20261117120000_sync_health'));
    writeFileSync(join(prisma, 'migrations', '20261117120000_sync_health', 'migration.sql'), 'SELECT 1;');
    const cliPackage = join(api, 'node_modules/prisma');
    mkdirSync(join(cliPackage, 'build'), { recursive: true });
    writeFileSync(join(cliPackage, 'package.json'), '{"name":"prisma","version":"0.0.0"}');
    writeFileSync(join(cliPackage, 'build/index.js'), `
      const fs=require('fs'),path=require('path');
      if(fs.existsSync(path.join(process.cwd(),'prisma.config.ts'))) process.exit(55);
      const schema=process.argv[process.argv.indexOf('--schema')+1];
      if(fs.existsSync(path.join(path.dirname(schema),'migrations','${retirementMigration}'))) process.exit(56);
    `);
    process.env.DATABASE_URL = 'postgresql://fixture@127.0.0.1:1/unused';
    assert.doesNotThrow(() => main(['expand', release]));
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    rmSync(release, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
