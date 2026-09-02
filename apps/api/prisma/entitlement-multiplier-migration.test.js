const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260902190000_entitlement_multiplier_snapshots',
    'migration.sql',
  ),
  'utf8',
);

describe('entitlement multiplier snapshot migration', () => {
  it('backfills grant and bucket snapshots from immutable purchase data', () => {
    assert.match(migration, /orders\."trafficMultiplierBasisPointsSnapshot"/);
    assert.match(migration, /product\."defaultTrafficMultiplierBasisPoints"/);
    assert.match(migration, /UPDATE "QuotaBucket" AS bucket/);
    assert.match(
      migration,
      /ADD COLUMN "trafficMultiplierBasisPointsSnapshot" INTEGER NOT NULL DEFAULT 10000/g,
    );
    assert.doesNotMatch(migration, /ALTER COLUMN .* SET NOT NULL/);
  });

  it('keeps constraints safe for concurrent writes during validation', () => {
    assert.equal((migration.match(/NOT VALID/g) ?? []).length, 2);
    assert.equal((migration.match(/VALIDATE CONSTRAINT/g) ?? []).length, 2);
  });

  it('adds an idempotency key for auditable compensation', () => {
    assert.match(migration, /"QuotaAdjustment_idempotencyKey_key"/);
  });

  it('keeps historical usage immutable', () => {
    assert.doesNotMatch(migration, /UPDATE "UsageRollup"/);
    assert.doesNotMatch(migration, /DELETE FROM "UsageRollup"/);
  });

  it('does not use PostgreSQL reserved words as update aliases', () => {
    assert.doesNotMatch(migration, /AS grant\b/);
  });
});
