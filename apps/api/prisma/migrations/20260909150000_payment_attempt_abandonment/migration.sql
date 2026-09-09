ALTER TABLE "EpayPaymentAttempt"
  ADD COLUMN "abandonedAt" TIMESTAMP(3),
  ADD COLUMN "abandonReason" TEXT;

CREATE INDEX "EpayPaymentAttempt_abandonedAt_idx"
  ON "EpayPaymentAttempt"("abandonedAt");
