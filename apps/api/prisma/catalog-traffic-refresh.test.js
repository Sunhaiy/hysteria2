const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260831141000_catalog_traffic_refresh',
    'migration.sql',
  ),
  'utf8',
);

describe('catalog traffic and permanent pack migration', () => {
  it('sets the approved plan traffic tiers', () => {
    for (const bytes of [
      3221225472, 53687091200, 128849018880, 322122547200, 644245094400,
      1099511627776,
    ]) {
      assert.match(migration, new RegExp(`\\b${bytes}\\b`));
    }
  });

  it('keeps one permanent offer for each approved traffic pack', () => {
    assert.match(migration, /"billingPeriod" = 'ONE_TIME'/);
    assert.match(migration, /"validityDays" = NULL/);
    assert.match(migration, /"requiresActivePlan" = false/);
    for (const price of [690, 1950, 3200, 6200, 12200, 30000]) {
      assert.match(migration, new RegExp(`\\b${price}\\b`));
    }
  });

  it('does not mutate links, subscriptions, existing grants, or usage', () => {
    assert.doesNotMatch(migration, /"storeUrl"\s*=/);
    assert.doesNotMatch(migration, /UPDATE "Subscription"/);
    assert.doesNotMatch(migration, /UPDATE "EntitlementGrant"/);
    assert.doesNotMatch(migration, /UPDATE "QuotaBucket"/);
    assert.doesNotMatch(migration, /UPDATE "UsageRollup"/);
  });
});
