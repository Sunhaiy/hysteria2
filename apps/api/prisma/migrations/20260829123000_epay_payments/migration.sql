ALTER TYPE "PaymentRecordSource" ADD VALUE IF NOT EXISTS 'EPAY';

CREATE TYPE "EpayPaymentStatus" AS ENUM (
  'PENDING',
  'SETTLED',
  'EXPIRED',
  'FAILED'
);

CREATE TABLE "EpayPaymentAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "orderId" TEXT,
  "merchantOrderNo" TEXT NOT NULL,
  "gatewayTradeNo" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" "EpayPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentType" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "basePriceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "productNameSnapshot" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpayPaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EpayPaymentAttempt_orderId_key"
  ON "EpayPaymentAttempt"("orderId");
CREATE UNIQUE INDEX "EpayPaymentAttempt_merchantOrderNo_key"
  ON "EpayPaymentAttempt"("merchantOrderNo");
CREATE UNIQUE INDEX "EpayPaymentAttempt_gatewayTradeNo_key"
  ON "EpayPaymentAttempt"("gatewayTradeNo");
CREATE UNIQUE INDEX "EpayPaymentAttempt_activeKey_key"
  ON "EpayPaymentAttempt"("activeKey");
CREATE UNIQUE INDEX "EpayPaymentAttempt_userId_idempotencyKey_key"
  ON "EpayPaymentAttempt"("userId", "idempotencyKey");
CREATE INDEX "EpayPaymentAttempt_userId_createdAt_idx"
  ON "EpayPaymentAttempt"("userId", "createdAt");
CREATE INDEX "EpayPaymentAttempt_status_expiresAt_idx"
  ON "EpayPaymentAttempt"("status", "expiresAt");
CREATE INDEX "EpayPaymentAttempt_offerId_status_idx"
  ON "EpayPaymentAttempt"("offerId", "status");

ALTER TABLE "EpayPaymentAttempt"
  ADD CONSTRAINT "EpayPaymentAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpayPaymentAttempt"
  ADD CONSTRAINT "EpayPaymentAttempt_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "CatalogOffer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EpayPaymentAttempt"
  ADD CONSTRAINT "EpayPaymentAttempt_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "ManualOrder"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
