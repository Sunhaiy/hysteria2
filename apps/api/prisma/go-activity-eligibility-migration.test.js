const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260910143000_harden_go_activity_eligibility',
    'migration.sql',
  ),
  'utf8',
);

test('Go activity eligibility repair changes only the catalog policy', () => {
  assert.match(migration, /"referralEligible"\s*=\s*FALSE/);
  assert.match(migration, /"purchaseLimitKey"\s*=\s*'trial-go'/);
  assert.match(migration, /legacy_plan\.slug\s*=\s*'go'/);
  assert.doesNotMatch(
    migration,
    /UPDATE\s+"(?:EntitlementGrant|QuotaBucket|QuotaAdjustment|DailyCheckIn|ReferralAttribution)"/i,
  );
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
});
