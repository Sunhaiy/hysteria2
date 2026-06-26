-- Enum additions
ALTER TYPE "RedemptionCodeKind" ADD VALUE IF NOT EXISTS 'BALANCE';
ALTER TYPE "RedemptionCodeKind" ADD VALUE IF NOT EXISTS 'DISCOUNT';

-- CreateEnum
CREATE TYPE "WalletTxnKind" AS ENUM ('TOPUP', 'PURCHASE', 'REFUND', 'ADJUST');

-- AlterTable User: wallet balance
ALTER TABLE "User" ADD COLUMN "balanceCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable RedemptionCode: multi-use + discount
ALTER TABLE "RedemptionCode" ADD COLUMN "discountPercent" INTEGER;
ALTER TABLE "RedemptionCode" ADD COLUMN "discountCents" INTEGER;
ALTER TABLE "RedemptionCode" ADD COLUMN "maxUses" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RedemptionCode" ADD COLUMN "usedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable RedemptionUse
CREATE TABLE "RedemptionUse" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionUse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RedemptionUse_codeId_userId_key" ON "RedemptionUse"("codeId", "userId");
CREATE INDEX "RedemptionUse_codeId_redeemedAt_idx" ON "RedemptionUse"("codeId", "redeemedAt");

ALTER TABLE "RedemptionUse" ADD CONSTRAINT "RedemptionUse_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "RedemptionCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RedemptionUse" ADD CONSTRAINT "RedemptionUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable WalletTransaction
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "kind" "WalletTxnKind" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt");

ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
