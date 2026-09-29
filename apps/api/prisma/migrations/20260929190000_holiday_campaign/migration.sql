ALTER TYPE "OrderKind" ADD VALUE 'WALLET_TOPUP';
ALTER TYPE "RefundMethod" ADD VALUE 'EPAY';
ALTER TABLE "EpayPaymentAttempt" ALTER COLUMN "offerId" DROP NOT NULL;
CREATE TABLE "HolidayCampaign" (
 "id" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
 "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL, "drawEndsAt" TIMESTAMP(3) NOT NULL,
 "giftBudgetCents" INTEGER NOT NULL DEFAULT 100000, "reservedGiftCents" INTEGER NOT NULL DEFAULT 0,
 "reservedDraws" INTEGER NOT NULL DEFAULT 0, "config" JSONB NOT NULL, "prizeStock" JSONB NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("giftBudgetCents">=0 AND "reservedGiftCents">=0 AND "reservedGiftCents"<="giftBudgetCents" AND "reservedDraws">=0)
);
CREATE TABLE "HolidayEntry" (
 "id" TEXT PRIMARY KEY, "campaignId" TEXT NOT NULL REFERENCES "HolidayCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "kind" TEXT NOT NULL, "tierId" TEXT, "claimKey" TEXT UNIQUE, "offerId" TEXT,
 "paymentType" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "attemptId" TEXT UNIQUE REFERENCES "EpayPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "orderId" TEXT UNIQUE REFERENCES "ManualOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "status" TEXT NOT NULL DEFAULT 'RESERVED', "amountCents" INTEGER NOT NULL, "giftCents" INTEGER NOT NULL DEFAULT 0,
 "snapshot" JSONB NOT NULL, "drawReserved" BOOLEAN NOT NULL DEFAULT false, "drawState" TEXT NOT NULL DEFAULT 'NONE',
 "drawKey" TEXT UNIQUE, "prizeCents" INTEGER NOT NULL DEFAULT 0, "reviewReason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "fulfilledAt" TIMESTAMP(3), "drawnAt" TIMESTAMP(3),
 CHECK ("amountCents">0 AND "giftCents">=0 AND "prizeCents">=0)
);
CREATE UNIQUE INDEX "HolidayEntry_userId_idempotencyKey_key" ON "HolidayEntry"("userId","idempotencyKey");
CREATE INDEX "HolidayEntry_campaignId_userId_status_idx" ON "HolidayEntry"("campaignId","userId","status");
