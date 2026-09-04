const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { describe, it } = require('node:test');

const sql = readFileSync(
  join(
    __dirname,
    'migrations',
    '20260905113000_homepage_product_selection',
    'migration.sql',
  ),
  'utf8',
);

describe('homepage product selection migration', () => {
  it('adds an independent flag and preserves the four products users already saw', () => {
    assert.match(
      sql,
      /ADD COLUMN "homepageVisible" BOOLEAN NOT NULL DEFAULT FALSE/,
    );
    assert.match(sql, /ORDER BY product\.featured DESC/);
    assert.match(sql, /ranked\.position <= 4/);
    assert.match(sql, /product\.kind = 'PLAN'/);
    assert.match(sql, /product\.status = 'ACTIVE'/);
  });

  it('does not mutate fulfilled commerce or entitlement data', () => {
    for (const table of [
      'ManualOrder',
      'PaymentRecord',
      'Subscription',
      'EntitlementGrant',
      'QuotaBucket',
      'UsageRollup',
    ]) {
      assert.doesNotMatch(sql, new RegExp(`(?:UPDATE|DELETE FROM) "${table}"`));
    }
  });
});
