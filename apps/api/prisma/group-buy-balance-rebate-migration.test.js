const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const migrationPath = path.join(
  __dirname,
  'migrations',
  '20260907190000_group_buy_balance_rebate',
  'migration.sql',
);

test('group-buy balance rebates preserve legacy groups and add an auditable member link', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /CREATE TYPE "GroupBuySettlementMode"/);
  assert.match(sql, /'ORIGINAL_PRICE_BALANCE_REBATE'/);
  assert.match(sql, /DEFAULT 'UPFRONT_DISCOUNT_REFUND_ON_FAILURE'/);
  assert.match(sql, /"rebateWalletLedgerId"/);
  assert.match(sql, /"walletIdempotencyKey"/);
  assert.match(sql, /"userId", "walletIdempotencyKey"/);
  assert.match(sql, /REFERENCES "WalletLedgerEntry"\("id"\)/);
  assert.doesNotMatch(sql, /^\s*(?:UPDATE|DELETE FROM|TRUNCATE)\s+/im);
});
