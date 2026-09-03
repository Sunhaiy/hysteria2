const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260903170000_align_standard_catalog_discounts',
    'migration.sql',
  ),
  'utf8',
);

describe('standard catalog discount alignment migration', () => {
  it('allows a fresh pre-seed database while guarding partial catalogs', () => {
    assert.match(
      migration,
      /IF active_products = 0 AND monthly_offers = 0 THEN\s+RETURN;/,
    );
    assert.match(
      migration,
      /IF active_products <> 9 OR monthly_offers <> 9 THEN/,
    );
  });

  it('derives quarterly and yearly prices from the live monthly offer', () => {
    assert.match(
      migration,
      /monthly_prices\."priceCents" \* 3 \* 95 \+ 50\) \/ 100/,
    );
    assert.match(
      migration,
      /monthly_prices\."priceCents" \* 12 \* 90 \+ 50\) \/ 100/,
    );
    assert.doesNotMatch(
      migration,
      /WHEN 'MONTHLY' THEN\s+\(monthly_prices\."priceCents"/,
    );
  });

  it('keeps the linked legacy offers and plan base price aligned', () => {
    assert.match(migration, /UPDATE "PlanOffer" AS legacy_offer/);
    assert.match(migration, /UPDATE "Plan" AS legacy_plan/);
    assert.match(
      migration,
      /legacy_offer\."priceCents" <> catalog_offer\."priceCents"/,
    );
  });

  it('does not touch fulfilled customer or payment data', () => {
    for (const table of [
      'EntitlementGrant',
      'QuotaBucket',
      'ManualOrder',
      'PaymentRecord',
      'Subscription',
      'UsageRollup',
    ]) {
      assert.doesNotMatch(migration, new RegExp(`UPDATE "${table}"`));
      assert.doesNotMatch(migration, new RegExp(`DELETE FROM "${table}"`));
    }
  });

  it('snapshots and verifies that store URLs remain unchanged', () => {
    assert.match(migration, /_StandardDiscountProductUrlSnapshot/);
    assert.match(migration, /_StandardDiscountOfferUrlSnapshot/);
    assert.match(migration, /IS DISTINCT FROM snapshot\."storeUrl"/);
  });
});
