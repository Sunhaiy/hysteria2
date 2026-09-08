const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const migrationPath = path.join(
  __dirname,
  'migrations',
  '20260907210000_business_integrity',
  'migration.sql',
);

test('business-integrity migration preserves auditable fulfillment and entitlement links', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /CREATE TYPE "PaymentFulfillmentStatus"/);
  assert.match(sql, /'REFUND_PENDING'/);
  assert.match(sql, /'MANUAL_REVIEW'/);
  assert.match(sql, /ADD COLUMN "fulfillmentStatus"/);
  assert.match(sql, /ADD COLUMN "reasonCode"/);
  assert.match(sql, /ADD COLUMN "rebateRecoveredCents"/);
  assert.match(sql, /ADD COLUMN "rebateUnrecoveredCents"/);
  assert.match(sql, /UPDATE "ManualOrder" AS orders/);
  assert.match(sql, /SET "entitlementGrantId"/);
  assert.match(sql, /orders\."status" = 'APPLIED'/);
  assert.match(sql, /"EpayPaymentAttempt_fulfillmentStatus_updatedAt_id_idx"/);
  assert.match(sql, /"GroupBuyMember_rebateUnrecoveredCents_updatedAt_id_idx"/);
  assert.doesNotMatch(sql, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
});
