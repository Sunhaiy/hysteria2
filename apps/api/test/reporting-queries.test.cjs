// Run the actual SQL against an isolated PostgreSQL engine; never use DATABASE_URL.
require('ts-node').register({ transpileOnly: true });
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const {
  latestNodeHealth,
  latestNodeChecks,
} = require('../src/monitoring/latest-node-history');
const {
  TrafficAnalyticsService,
} = require('../src/traffic-analytics/traffic-analytics.service');
const db = new PGlite();
const statements = [];
const reader = {
  async $queryRaw(sql) {
    statements.push(sql);
    return (await db.query(sql.text, sql.values)).rows;
  },
};
before(async () => {
  await db.exec(`
    CREATE TABLE "NodeServer" (id text PRIMARY KEY, name text, "createdAt" timestamp, "retiredAt" timestamp);
    CREATE TABLE "Node" (id text PRIMARY KEY, hostname text, "serverId" text, "createdAt" timestamp, "retiredAt" timestamp);
    CREATE TABLE "NodeHealthSnapshot" (id text PRIMARY KEY, "nodeId" text, "checkedAt" timestamp, healthy boolean);
    CREATE TABLE "NodeServiceCheck" (LIKE "NodeHealthSnapshot" INCLUDING ALL);
    CREATE INDEX ON "NodeHealthSnapshot" ("nodeId", "checkedAt");
    CREATE INDEX ON "NodeServiceCheck" ("nodeId", "checkedAt");
    INSERT INTO "NodeServer" VALUES ('server', 'Shared machine', '2026-01-01', NULL), ('empty', 'Empty machine', '2026-01-01', NULL), ('retired', 'Retired machine', '2026-01-01', '2026-01-15');
    INSERT INTO "Node" VALUES ('hy', 'hy', 'server', '2026-01-01', NULL), ('vl', 'vl', 'server', '2026-01-01', NULL), ('legacy', 'Legacy node', NULL, '2026-01-01', NULL), ('none', 'none', 'empty', '2026-01-01', NULL);
    INSERT INTO "NodeHealthSnapshot"
      SELECT node || i, node, '2026-01-01'::timestamp + i * interval '1 minute', i = 2000
      FROM unnest(ARRAY['hy', 'vl']) node CROSS JOIN generate_series(1, 2000) i;
    INSERT INTO "NodeServiceCheck" SELECT * FROM "NodeHealthSnapshot";
    CREATE TABLE "UsageRollup" (id text PRIMARY KEY, "nodeId" text, "bucketStart" timestamp, "txBytes" bigint, "rxBytes" bigint, "rawBytes" bigint);
    CREATE INDEX ON "UsageRollup" ("bucketStart", id);
    INSERT INTO "UsageRollup" VALUES
      ('before', 'hy', '2026-01-31 15:59:59.999', 999, 999, 999),
      ('start', 'hy', '2026-01-31 16:00:00', 10, 20, 35),
      ('same-server', 'vl', '2026-02-01 12:00:00', 30, 40, NULL),
      ('next-day', 'hy', '2026-02-01 16:00:00', 50, 60, 0),
      ('legacy', 'legacy', '2026-02-28 15:59:59.999', 70, 80, NULL),
      ('after', 'hy', '2026-02-28 16:00:00', 999, 999, 999);
    INSERT INTO "UsageRollup"
      SELECT 'background-' || i, 'hy', '2026-01-01'::timestamp + i * interval '30 seconds', 1, 2, 3
      FROM generate_series(1, 80000) i;
    ANALYZE;
  `);
});
after(() => db.close());

test('latest history is bounded per node, retains Date types and handles empty/missing nodes', async () => {
  for (const latest of [latestNodeHealth, latestNodeChecks]) {
    const count = statements.length;
    assert.equal((await latest(reader, [])).size, 0);
    assert.equal(statements.length, count);
    const rows = await latest(reader, ['vl', 'hy', 'none', "untrusted'); --"]);
    assert.equal(rows.size, 2);
    assert.equal(rows.get('hy').id, 'hy2000');
    assert.equal(rows.get('vl').healthy, true);
    assert.ok(rows.get('hy').checkedAt instanceof Date);
    const sql = statements.at(-1);
    const plan = (
      await db.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + sql.text, sql.values)
    ).rows[0]['QUERY PLAN'][0].Plan;
    const walk = (p) => [p, ...(p.Plans ?? []).flatMap(walk)];
    const limit = walk(plan).find((p) => p['Node Type'] === 'Limit');
    assert.ok(
      limit,
      'limit must execute in Postgres, before history reaches the application',
    );
    assert.ok(limit['Actual Rows'] <= 1);
    assert.equal(plan['Actual Rows'], 2);
  }
});

test('monthly report preserves Shanghai boundaries, raw-byte fallback, shared servers and empty inventory', async () => {
  const result = await new TrafficAnalyticsService(reader).serverMonthly(
    { month: '2026-02' },
    new Date('2026-02-02T12:00:00Z'),
  );
  assert.equal(result.dates.length, 28);
  assert.deepEqual(result.totals, {
    txBytes: 160,
    rxBytes: 200,
    physicalBytes: 255,
    todayPhysicalBytes: 0,
  });
  assert.equal(result.servers.length, 3);
  const server = result.servers.find((s) => s.id === 'server');
  assert.deepEqual(server.days[0], {
    date: '2026-02-01',
    txBytes: 40,
    rxBytes: 60,
    physicalBytes: 105,
  });
  assert.deepEqual(server.days[1], {
    date: '2026-02-02',
    txBytes: 50,
    rxBytes: 60,
    physicalBytes: 0,
  });
  assert.equal(result.servers.find((s) => s.id === 'empty').physicalBytes, 0);
});

test('monthly report uses bounded daily index reads instead of scanning the entire ledger', async () => {
  await new TrafficAnalyticsService(reader).serverMonthly({ month: '2026-01' });
  const sql = statements.at(-1);
  const plan = (
    await db.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + sql.text, sql.values)
  ).rows[0]['QUERY PLAN'][0].Plan;
  const walk = (p) => [p, ...(p.Plans ?? []).flatMap(walk)];
  const reads = walk(plan).filter((p) => p['Relation Name'] === 'UsageRollup');
  assert.ok(reads.length > 0);
  assert.ok(
    reads.every((p) => p['Node Type'] !== 'Seq Scan'),
    'monthly report scanned the whole ledger',
  );
  assert.ok(
    reads.every((p) => p['Actual Rows'] <= 3000),
    'a single read consumed more than one day of ledger rows',
  );
});
