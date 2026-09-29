CREATE TABLE "HolidayDrawTicket" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "campaignId" TEXT NOT NULL REFERENCES "HolidayCampaign"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL,
  "entryId" TEXT REFERENCES "HolidayEntry"("id") ON DELETE CASCADE,
  "sourceOrderId" TEXT,
  "source" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL UNIQUE,
  "state" TEXT NOT NULL DEFAULT 'RESERVED',
  "drawKey" TEXT UNIQUE,
  "prizeCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "drawnAt" TIMESTAMP(3)
);
CREATE INDEX "HolidayDrawTicket_campaignId_userId_state_idx" ON "HolidayDrawTicket"("campaignId", "userId", "state");
CREATE INDEX "HolidayDrawTicket_sourceOrderId_idx" ON "HolidayDrawTicket"("sourceOrderId");
-- Preserve the single chance promised by existing orders, including draw replay keys.
INSERT INTO "HolidayDrawTicket" ("id", "campaignId", "userId", "entryId", "sourceOrderId", "source", "sourceKey", "state", "drawKey", "prizeCents", "createdAt", "drawnAt")
SELECT 'legacy-' || "id", "campaignId", "userId", "id", "orderId", 'ORDER', 'legacy:' || "id", "drawState", "drawKey", "prizeCents", "createdAt", "drawnAt"
FROM "HolidayEntry" WHERE "drawReserved" = true;
