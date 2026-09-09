const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const migrationPath = path.join(
  __dirname,
  'migrations',
  '20260909150000_payment_attempt_abandonment',
  'migration.sql',
);

test('payment-attempt abandonment migration is additive and preserves existing orders', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /ADD COLUMN "abandonedAt" TIMESTAMP\(3\)/);
  assert.match(sql, /ADD COLUMN "abandonReason" TEXT/);
  assert.match(sql, /EpayPaymentAttempt_abandonedAt_idx/);
  assert.doesNotMatch(sql, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
  assert.doesNotMatch(sql, /UPDATE "EpayPaymentAttempt"/i);
});
