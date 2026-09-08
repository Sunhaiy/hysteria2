const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const migrationPath = path.join(
  __dirname,
  'migrations',
  '20260907120000_daily_checkin_group_buy',
  'migration.sql',
);
const repairMigrationPath = path.join(
  __dirname,
  'migrations',
  '20260908132500_ensure_group_buy_bonus_product',
  'migration.sql',
);
const memberSnapshotMigrationPath = path.join(
  __dirname,
  'migrations',
  '20260908162000_group_buy_member_entitlement_snapshot',
  'migration.sql',
);

test('daily check-in and group-buy migration is additive and keeps existing rows untouched', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const table of [
    'DailyCheckIn',
    'GroupBuyCampaign',
    'GroupBuy',
    'GroupBuyMember',
    'EpayRefundAttempt',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(sql, /system_group_buy_traffic_bonus/);
  assert.match(sql, /"discountBasisPoints" INTEGER NOT NULL DEFAULT 10000/);
  assert.match(
    sql,
    /"discountBasisPointsSnapshot" INTEGER NOT NULL DEFAULT 10000/,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:UPDATE|DELETE FROM|TRUNCATE)\s+"(?:User|Subscription|EntitlementGrant|QuotaBucket|ManualOrder)"/i,
  );
});

test('group-buy bonus product repair is idempotent and leaves business data untouched', () => {
  const sql = fs.readFileSync(repairMigrationPath, 'utf8');
  assert.match(sql, /INSERT INTO "CatalogProduct"/);
  assert.match(sql, /system_group_buy_traffic_bonus/);
  assert.match(sql, /ON CONFLICT \("id"\) DO UPDATE SET/);
  assert.match(sql, /"systemManaged" = EXCLUDED\."systemManaged"/);
  assert.doesNotMatch(
    sql,
    /\b(?:UPDATE|DELETE FROM|TRUNCATE)\s+"(?:User|Subscription|EntitlementGrant|QuotaBucket|ManualOrder|PaymentRecord|WalletLedgerEntry)"/i,
  );
});

test('group-buy member snapshots are added without rewriting existing rows', () => {
  const sql = fs.readFileSync(memberSnapshotMigrationPath, 'utf8');
  assert.match(
    sql,
    /ALTER TABLE "GroupBuyMember"\s+ADD COLUMN "entitlementSnapshot" JSONB;/,
  );
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE FROM|TRUNCATE)\b/i);
});
