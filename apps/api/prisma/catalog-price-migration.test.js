const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260831103000_catalog_price_refresh',
    'migration.sql',
  ),
  'utf8',
);

describe('production catalog price migration', () => {
  it('contains the approved monthly and discounted prices', () => {
    for (const price of [
      1290, 3677, 13932, 2100, 5985, 22680, 7200, 20520, 77760,
    ]) {
      assert.match(migration, new RegExp(`\\b${price}\\b`));
    }
  });

  it('sets Spark catalog and active quota projections to exactly 1024 GiB', () => {
    assert.match(migration, /1099511627776/);
    assert.match(migration, /UPDATE "Subscription"/);
    assert.match(migration, /UPDATE "SubscriptionCycle"/);
    assert.match(migration, /UPDATE "QuotaBucket"/);
  });

  it('does not update store links, subscription tokens, usage, or order snapshots', () => {
    assert.doesNotMatch(migration, /"storeUrl"\s*=/);
    assert.doesNotMatch(migration, /UPDATE "AccessToken"/);
    assert.doesNotMatch(migration, /UPDATE "UsageRollup"/);
    assert.doesNotMatch(migration, /UPDATE "ManualOrder"/);
  });
});
