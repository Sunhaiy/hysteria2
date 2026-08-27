CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'REVERSED');

ALTER TABLE "CatalogProduct"
ADD COLUMN "systemManaged" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralAttribution" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "inviterRewardCents" INTEGER NOT NULL,
    "inviteeRewardBytes" BIGINT NOT NULL,
    "qualifyingOrderId" TEXT,
    "rewardWalletLedgerId" TEXT,
    "reversalWalletLedgerId" TEXT,
    "bonusEntitlementGrantId" TEXT,
    "rewardedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "recoveredCents" INTEGER NOT NULL DEFAULT 0,
    "unrecoveredCents" INTEGER NOT NULL DEFAULT 0,
    "revokedUnusedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralCode_ownerId_key" ON "ReferralCode"("ownerId");
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");
CREATE UNIQUE INDEX "ReferralAttribution_inviteeId_key" ON "ReferralAttribution"("inviteeId");
CREATE UNIQUE INDEX "ReferralAttribution_qualifyingOrderId_key" ON "ReferralAttribution"("qualifyingOrderId");
CREATE UNIQUE INDEX "ReferralAttribution_rewardWalletLedgerId_key" ON "ReferralAttribution"("rewardWalletLedgerId");
CREATE UNIQUE INDEX "ReferralAttribution_reversalWalletLedgerId_key" ON "ReferralAttribution"("reversalWalletLedgerId");
CREATE UNIQUE INDEX "ReferralAttribution_bonusEntitlementGrantId_key" ON "ReferralAttribution"("bonusEntitlementGrantId");
CREATE INDEX "ReferralAttribution_inviterId_status_createdAt_id_idx" ON "ReferralAttribution"("inviterId", "status", "createdAt", "id");
CREATE INDEX "ReferralAttribution_status_createdAt_id_idx" ON "ReferralAttribution"("status", "createdAt", "id");
CREATE INDEX "ReferralAttribution_codeSnapshot_createdAt_id_idx" ON "ReferralAttribution"("codeSnapshot", "createdAt", "id");

ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_inviterId_fkey"
FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_inviteeId_fkey"
FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_referralCodeId_fkey"
FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_qualifyingOrderId_fkey"
FOREIGN KEY ("qualifyingOrderId") REFERENCES "ManualOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_rewardWalletLedgerId_fkey"
FOREIGN KEY ("rewardWalletLedgerId") REFERENCES "WalletLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_reversalWalletLedgerId_fkey"
FOREIGN KEY ("reversalWalletLedgerId") REFERENCES "WalletLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_bonusEntitlementGrantId_fkey"
FOREIGN KEY ("bonusEntitlementGrantId") REFERENCES "EntitlementGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "CatalogProduct" (
    "id", "slug", "kind", "status", "name", "description",
    "quotaCadence", "speedUpMbps", "speedDownMbps",
    "defaultTrafficMultiplierBasisPoints", "accent", "sortOrder",
    "systemManaged", "createdAt", "updatedAt"
) VALUES (
    'system_referral_traffic_bonus', 'system-referral-traffic-bonus',
    'TRAFFIC_PACK', 'ARCHIVED', '邀请奖励流量', '系统管理的邀请奖励权益',
    'ONE_TIME', 0, 0, 10000, 'green', 2147483647, true,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
