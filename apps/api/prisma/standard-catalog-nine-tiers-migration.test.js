const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260903163000_standard_catalog_nine_tiers',
    'migration.sql',
  ),
  'utf8',
);

const approvedPlans = [
  ['Go', 1_073_741_824, 200, 570, 2160],
  ['Start', 32_212_254_720, 890, 2537, 9612],
  ['Pro', 85_899_345_920, 1290, 3677, 13932],
  ['Boost', 161_061_273_600, 1790, 5102, 19332],
  ['Plus', 268_435_456_000, 2490, 7097, 26892],
  ['Prime', 375_809_638_400, 3490, 9947, 37692],
  ['Max', 536_870_912_000, 4990, 14222, 53892],
  ['Elite', 805_306_368_000, 6490, 18497, 70092],
  ['Spark', 1_073_741_824_000, 7900, 22515, 85320],
];

describe('nine-tier standard catalog migration', () => {
  it('contains the exact approved quota and price ladder', () => {
    for (const [name, bytes, monthly, quarterly, yearly] of approvedPlans) {
      assert.match(migration, new RegExp(`'${name}'`));
      for (const value of [bytes, monthly, quarterly, yearly]) {
        assert.match(migration, new RegExp(`\\b${value}\\b`));
      }
    }
  });

  it('adds Boost, Prime, and Elite as active standard monthly-reset plans', () => {
    for (const slug of ['boost', 'prime', 'elite']) {
      assert.match(migration, new RegExp(`catalog-standard-${slug}`));
      assert.match(migration, new RegExp(`plan-standard-${slug}`));
    }
    assert.match(migration, /'STANDARD'::"CatalogProductSeries"/);
    assert.match(migration, /'MONTHLY_RESET'::"QuotaCadence"/);
    assert.match(migration, /21000/);
  });

  it('keeps existing links and all fulfilled business data untouched', () => {
    assert.doesNotMatch(migration, /"storeUrl"\s*=/);
    assert.doesNotMatch(migration, /UPDATE\s+"Subscription"/i);
    assert.doesNotMatch(migration, /UPDATE\s+"EntitlementGrant"/i);
    assert.doesNotMatch(migration, /UPDATE\s+"QuotaBucket"/i);
    assert.doesNotMatch(migration, /UPDATE\s+"ManualOrder"/i);
    assert.doesNotMatch(migration, /UPDATE\s+"PaymentRecord"/i);
    assert.doesNotMatch(migration, /UPDATE\s+"RedemptionCode"/i);
    assert.doesNotMatch(migration, /UPDATE\s+"UsageRollup"/i);
    assert.match(migration, /changed an existing offer store URL/);
    assert.match(migration, /changed an existing product store URL/);
  });

  it('keeps Ultra products outside the standard catalog mutation', () => {
    assert.match(migration, /series = 'STANDARD'/);
    assert.match(migration, /changed the Ultra catalog/);
    assert.doesNotMatch(
      migration,
      /\bUPDATE\s+"[^"]+"[\s\S]{0,160}series\s*=\s*'ULTRA'/i,
    );
  });
});
