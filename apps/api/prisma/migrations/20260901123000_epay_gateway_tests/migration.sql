CREATE TABLE "EpayGatewayTestAttempt" (
  "id" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "merchantOrderNo" TEXT NOT NULL,
  "gatewayTradeNo" TEXT,
  "activeKey" TEXT,
  "status" "EpayPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentType" TEXT NOT NULL,
  "gatewayUrlSnapshot" TEXT NOT NULL,
  "merchantIdSnapshot" TEXT NOT NULL,
  "merchantKeyCiphertext" TEXT NOT NULL,
  "configFingerprint" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpayGatewayTestAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EpayGatewayTestAttempt_merchantOrderNo_key"
  ON "EpayGatewayTestAttempt"("merchantOrderNo");
CREATE UNIQUE INDEX "EpayGatewayTestAttempt_gatewayTradeNo_key"
  ON "EpayGatewayTestAttempt"("gatewayTradeNo");
CREATE UNIQUE INDEX "EpayGatewayTestAttempt_activeKey_key"
  ON "EpayGatewayTestAttempt"("activeKey");
CREATE INDEX "EpayGatewayTestAttempt_requestedById_createdAt_idx"
  ON "EpayGatewayTestAttempt"("requestedById", "createdAt");
CREATE INDEX "EpayGatewayTestAttempt_configFingerprint_status_settledAt_idx"
  ON "EpayGatewayTestAttempt"("configFingerprint", "status", "settledAt");
CREATE INDEX "EpayGatewayTestAttempt_status_expiresAt_idx"
  ON "EpayGatewayTestAttempt"("status", "expiresAt");

ALTER TABLE "EpayGatewayTestAttempt"
  ADD CONSTRAINT "EpayGatewayTestAttempt_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
