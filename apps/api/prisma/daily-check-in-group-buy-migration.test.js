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
