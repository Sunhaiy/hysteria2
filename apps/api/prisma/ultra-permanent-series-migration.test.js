const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260902220000_ultra_permanent_series',
    'migration.sql',
  ),
  'utf8',
);

describe('permanent Ultra series migration', () => {
  it('creates one active Ultra slot and immutable order/grant snapshots', () => {
    assert.match(migration, /CREATE TYPE "CatalogProductSeries"/);
    assert.match(migration, /"quotaCadenceSnapshot" "QuotaCadence"/);
    assert.match(migration, /"resetAnchorAt" TIMESTAMP\(3\)/);
    assert.match(migration, /"EntitlementGrant_userId_activeSlot_key"/);
    assert.match(migration, /"ManualOrder_entitlementGrantId_fkey"/);
    assert.doesNotMatch(
      migration,
      /JOIN\s+"CatalogOffer"[\s\S]*?ON[^\n]*grants\."offerId"/,
    );
  });

  it('seeds the approved draft tiers and leaves the shared node group empty', () => {
    assert.match(
      migration,
      /'ultra-120'.*'ULTRA', 'DRAFT'[\s\S]*128849018880, 6900/,
    );
    assert.match(
      migration,
      /'ultra-360'.*'ULTRA', 'DRAFT'[\s\S]*386547056640, 12900/,
    );
    assert.match(
      migration,
      /'ultra-600'.*'ULTRA', 'DRAFT'[\s\S]*644245094400, 26000/,
    );
    assert.doesNotMatch(migration, /INSERT INTO "AccessProfileNode"/);
  });

  it('does not rewrite subscriptions, nodes, usage, or quota history', () => {
    assert.doesNotMatch(migration, /UPDATE "Subscription"/);
    assert.doesNotMatch(migration, /UPDATE "Node"/);
    assert.doesNotMatch(migration, /UPDATE "UsageRollup"/);
    assert.doesNotMatch(migration, /UPDATE "QuotaBucket"/);
    assert.doesNotMatch(migration, /DELETE FROM/);
  });
});
