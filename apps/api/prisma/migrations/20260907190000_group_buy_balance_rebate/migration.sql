CREATE TYPE "GroupBuySettlementMode" AS ENUM (
  'UPFRONT_DISCOUNT_REFUND_ON_FAILURE',
  'ORIGINAL_PRICE_BALANCE_REBATE'
);

ALTER TABLE "GroupBuy"
ADD COLUMN "settlementModeSnapshot" "GroupBuySettlementMode" NOT NULL
DEFAULT 'UPFRONT_DISCOUNT_REFUND_ON_FAILURE';

ALTER TABLE "GroupBuyMember"
ADD COLUMN "rebateWalletLedgerId" TEXT,
ADD COLUMN "walletIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "GroupBuyMember_rebateWalletLedgerId_key"
ON "GroupBuyMember"("rebateWalletLedgerId");

CREATE UNIQUE INDEX "GroupBuyMember_userId_walletIdempotencyKey_key"
ON "GroupBuyMember"("userId", "walletIdempotencyKey");

ALTER TABLE "GroupBuyMember"
ADD CONSTRAINT "GroupBuyMember_rebateWalletLedgerId_fkey"
FOREIGN KEY ("rebateWalletLedgerId") REFERENCES "WalletLedgerEntry"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
