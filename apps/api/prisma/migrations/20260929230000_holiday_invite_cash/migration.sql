CREATE TABLE "HolidayInviteReward" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "campaignId" TEXT NOT NULL REFERENCES "HolidayCampaign"("id") ON DELETE CASCADE,
  "inviterId" TEXT NOT NULL,
  "inviteeId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "sourceOrderId" TEXT UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rewardedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "HolidayInviteReward_campaignId_inviteeId_key" ON "HolidayInviteReward"("campaignId", "inviteeId");
CREATE INDEX "HolidayInviteReward_inviterId_status_idx" ON "HolidayInviteReward"("inviterId", "status");
