#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const retirementMigration = '20261116120000_remove_agent_updates';

export function prepareExpandSchema(releaseDirectory) {
  const prisma = join(releaseDirectory, 'apps/api/prisma');
  if (!existsSync(join(prisma, 'migrations', retirementMigration, 'migration.sql'))) {
    throw new Error('Expected updater contract migration is missing');
  }
  const staged = mkdtempSync(join(tmpdir(), 'hysteria-expand-migrations-'));
  try {
    cpSync(join(prisma, 'schema.prisma'), join(staged, 'schema.prisma'));
    mkdirSync(join(staged, 'migrations'));
    for (const item of readdirSync(join(prisma, 'migrations'), { withFileTypes: true })) {
      if (item.name === retirementMigration) continue;
      cpSync(join(prisma, 'migrations', item.name), join(staged, 'migrations', item.name), { recursive: true });
    }
    return staged;
  } catch (error) {
    rmSync(staged, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}

export function assertOldProcessesDrained(records, alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}) {
  if (!Array.isArray(records) || records.length !== 3 || new Set(records.map(row => row.role)).size !== 3 || !['api', 'web', 'worker'].every(role => records.some(row => row.role === role))) {
    throw new Error('Record the old api, web and worker PIDs before cutover');
  }
  if (new Set(records.map(row => row.pid)).size !== 3) throw new Error('Old process PIDs must be distinct');
  for (const row of records) {
    if (!Number.isSafeInteger(row.pid) || row.pid <= 1) throw new Error('Invalid old process PID');
    if (alive(row.pid)) throw new Error(`Old ${row.role} process ${row.pid} is still running; contract migration refused`);
  }
}

export function main(args = process.argv.slice(2)) {
  const [phase, requestedRelease, oldProcessFile] = args;
  if (!['expand', 'expand-status', 'contract'].includes(phase) || !requestedRelease || args.length !== (phase === 'contract' ? 3 : 2)) {
    throw new Error('Usage: staged-migrations.mjs expand|expand-status RELEASE_DIR | contract RELEASE_DIR OLD_PROCESS_JSON');
  }
  if (!process.env.DATABASE_URL) throw new Error('Load the intended DATABASE_URL into the environment first');
  const release = resolve(requestedRelease);
  if (phase === 'contract') assertOldProcessesDrained(JSON.parse(readFileSync(oldProcessFile, 'utf8')));
  let staged;
  try {
    if (phase !== 'contract') staged = prepareExpandSchema(release);
    const schema = staged ? join(staged, 'schema.prisma') : join(release, 'apps/api/prisma/schema.prisma');
    const cli = createRequire(join(release, 'apps/api/package.json')).resolve('prisma/build/index.js');
    const result = spawnSync(process.execPath, [cli, 'migrate', phase === 'expand-status' ? 'status' : 'deploy', '--schema', schema], {
      // prisma.config.ts can pin migrations.path independently of --schema.
      // Standalone cwd prevents the release config from pulling the deferred
      // contract back into the additive phase.
      cwd: staged || join(release, 'apps/api'), env: process.env, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${phase} migration failed; do not switch or record it as applied`);
    console.log(`${phase} migrations verified by Prisma; no migration records were synthesized`);
  } finally {
    if (staged) rmSync(staged, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
