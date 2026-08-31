const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260831190000_catalog_max_price_and_order',
    'migration.sql',
  ),
  'utf8',
);

describe('Max price and catalog order repair migration', () => {
  it('sets the approved Max monthly, quarterly, and yearly prices', () => {
    for (const price of [4590, 13082, 49572]) {
      assert.match(migration, new RegExp(`\\b${price}\\b`));
    }
    assert.match(migration, /catalog_plan_f0e5ce428c3216f495/);
    assert.match(migration, /cmqtapuwb0003douxqnb69pik/);
  });

  it('pins the six plan products to the approved order', () => {
    for (const [productId, sortOrder] of [
      ['catalog_plan_092ce625dafa9850e9', 10],
      ['bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f', 20],
      ['catalog_plan_cd0834350a821c49fa', 30],
      ['catalog_plan_bf90fb70eca4148d11', 40],
      ['catalog_plan_f0e5ce428c3216f495', 50],
      ['catalog_plan_bc534fcbb40f0f9e06', 60],
    ]) {
      assert.match(
        migration,
        new RegExp(`\\('${productId}',\\s*${sortOrder}\\)`),
      );
    }
  });

  it('does not change links, subscriptions, usage, grants, or order snapshots', () => {
    assert.doesNotMatch(migration, /"storeUrl"\s*=/);
    assert.doesNotMatch(migration, /UPDATE "Subscription"/);
    assert.doesNotMatch(migration, /UPDATE "UsageRollup"/);
    assert.doesNotMatch(migration, /UPDATE "EntitlementGrant"/);
    assert.doesNotMatch(migration, /UPDATE "ManualOrder"/);
  });
});
