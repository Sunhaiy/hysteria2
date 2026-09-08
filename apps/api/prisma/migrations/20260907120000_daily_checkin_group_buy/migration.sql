CREATE TYPE "GroupBuyStatus" AS ENUM (
  'PENDING_PAYMENT',
  'OPEN',
  'FULFILLING',
  'SUCCEEDED',
  'REFUNDING',
  'REFUNDED',
  'FALLBACK_FULFILLED',
  'EXCEPTION',
  'CANCELED'
);

CREATE TYPE "GroupBuyMemberStatus" AS ENUM (
  'PAYMENT_PENDING',
  'PAID',
  'FULFILLED',
  'REFUND_PENDING',
  'REFUNDED',
  'FALLBACK_FULFILLED',
  'PAYMENT_CLOSED',
  'EXCEPTION'
);

CREATE TYPE "EpayRefundStatus" AS ENUM (
  'PENDING',
  'SUBMITTED',
  'CONFIRMED',
  'FAILED'
);

CREATE TABLE "DailyCheckIn" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "rewardBytes" BIGINT NOT NULL,
  "entitlementGrantId" TEXT NOT NULL,
  "quotaBucketId" TEXT NOT NULL,
  "subscriptionCycleId" TEXT,
  "quotaAdjustmentId" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuyCampaign" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "requiredMembers" INTEGER NOT NULL DEFAULT 2,
  "durationMinutes" INTEGER NOT NULL DEFAULT 1440,
  "discountBasisPoints" INTEGER NOT NULL DEFAULT 10000,
  "bonusTrafficBytes" BIGINT NOT NULL DEFAULT 21474836480,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupBuyCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuy" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "shareCode" TEXT NOT NULL,
  "status" "GroupBuyStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "offerIdSnapshot" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "offerNameSnapshot" TEXT NOT NULL,
  "priceCentsSnapshot" INTEGER NOT NULL,
  "currencySnapshot" TEXT NOT NULL DEFAULT 'CNY',
  "requiredMembersSnapshot" INTEGER NOT NULL DEFAULT 2,
  "discountBasisPointsSnapshot" INTEGER NOT NULL DEFAULT 10000,
  "bonusTrafficBytesSnapshot" BIGINT NOT NULL DEFAULT 21474836480,
  "entitlementSnapshot" JSONB NOT NULL,
  "openedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupBuy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuyMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "isCreator" BOOLEAN NOT NULL DEFAULT false,
  "status" "GroupBuyMemberStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
  "activeSlot" TEXT,
  "paymentAttemptId" TEXT,
  "orderId" TEXT,
  "bonusEntitlementGrantId" TEXT,
  "paidAt" TIMESTAMP(3),
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupBuyMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EpayRefundAttempt" (
  "id" TEXT NOT NULL,
  "paymentAttemptId" TEXT NOT NULL,
  "groupBuyMemberId" TEXT,
  "status" "EpayRefundStatus" NOT NULL DEFAULT 'PENDING',
  "amountCents" INTEGER NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "gatewayMessage" TEXT,
  "fallbackAllowedAt" TIMESTAMP(3),
  "lastRequestedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpayRefundAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyCheckIn_quotaAdjustmentId_key" ON "DailyCheckIn"("quotaAdjustmentId");
CREATE UNIQUE INDEX "DailyCheckIn_userId_businessDate_key" ON "DailyCheckIn"("userId", "businessDate");
CREATE INDEX "DailyCheckIn_businessDate_claimedAt_id_idx" ON "DailyCheckIn"("businessDate", "claimedAt", "id");
CREATE INDEX "DailyCheckIn_userId_claimedAt_id_idx" ON "DailyCheckIn"("userId", "claimedAt", "id");

CREATE UNIQUE INDEX "GroupBuyCampaign_offerId_key" ON "GroupBuyCampaign"("offerId");
CREATE INDEX "GroupBuyCampaign_enabled_updatedAt_idx" ON "GroupBuyCampaign"("enabled", "updatedAt");

CREATE UNIQUE INDEX "GroupBuy_shareCode_key" ON "GroupBuy"("shareCode");
CREATE INDEX "GroupBuy_status_expiresAt_id_idx" ON "GroupBuy"("status", "expiresAt", "id");
CREATE INDEX "GroupBuy_campaignId_status_createdAt_id_idx" ON "GroupBuy"("campaignId", "status", "createdAt", "id");
CREATE INDEX "GroupBuy_creatorId_createdAt_id_idx" ON "GroupBuy"("creatorId", "createdAt", "id");

CREATE UNIQUE INDEX "GroupBuyMember_activeSlot_key" ON "GroupBuyMember"("activeSlot");
CREATE UNIQUE INDEX "GroupBuyMember_paymentAttemptId_key" ON "GroupBuyMember"("paymentAttemptId");
CREATE UNIQUE INDEX "GroupBuyMember_orderId_key" ON "GroupBuyMember"("orderId");
CREATE UNIQUE INDEX "GroupBuyMember_bonusEntitlementGrantId_key" ON "GroupBuyMember"("bonusEntitlementGrantId");
CREATE UNIQUE INDEX "GroupBuyMember_groupId_userId_key" ON "GroupBuyMember"("groupId", "userId");
CREATE INDEX "GroupBuyMember_groupId_status_createdAt_id_idx" ON "GroupBuyMember"("groupId", "status", "createdAt", "id");
CREATE INDEX "GroupBuyMember_userId_status_createdAt_id_idx" ON "GroupBuyMember"("userId", "status", "createdAt", "id");

CREATE UNIQUE INDEX "EpayRefundAttempt_paymentAttemptId_key" ON "EpayRefundAttempt"("paymentAttemptId");
CREATE UNIQUE INDEX "EpayRefundAttempt_groupBuyMemberId_key" ON "EpayRefundAttempt"("groupBuyMemberId");
CREATE INDEX "EpayRefundAttempt_status_updatedAt_id_idx" ON "EpayRefundAttempt"("status", "updatedAt", "id");

ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_entitlementGrantId_fkey" FOREIGN KEY ("entitlementGrantId") REFERENCES "EntitlementGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_quotaBucketId_fkey" FOREIGN KEY ("quotaBucketId") REFERENCES "QuotaBucket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_subscriptionCycleId_fkey" FOREIGN KEY ("subscriptionCycleId") REFERENCES "SubscriptionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_quotaAdjustmentId_fkey" FOREIGN KEY ("quotaAdjustmentId") REFERENCES "QuotaAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GroupBuyCampaign" ADD CONSTRAINT "GroupBuyCampaign_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CatalogOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GroupBuyCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "GroupBuyMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GroupBuy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "GroupBuyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "GroupBuyMember_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "EpayPaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "GroupBuyMember_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManualOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "GroupBuyMember_bonusEntitlementGrantId_fkey" FOREIGN KEY ("bonusEntitlementGrantId") REFERENCES "EntitlementGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EpayRefundAttempt" ADD CONSTRAINT "EpayRefundAttempt_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "EpayPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EpayRefundAttempt" ADD CONSTRAINT "EpayRefundAttempt_groupBuyMemberId_fkey" FOREIGN KEY ("groupBuyMemberId") REFERENCES "GroupBuyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "CatalogProduct" (
  "id", "slug", "kind", "series", "status", "name", "description",
  "quotaCadence", "speedUpMbps", "speedDownMbps", "defaultTrafficMultiplierBasisPoints",
  "sortOrder", "featured", "homepageVisible", "requiresActivePlan", "referralEligible",
  "systemManaged", "createdAt", "updatedAt"
)
VALUES (
  'system_group_buy_traffic_bonus', 'system-group-buy-traffic-bonus',
  'TRAFFIC_PACK', 'STANDARD', 'DRAFT', '拼团赠送流量', '系统发放的拼团成功奖励',
  'ONE_TIME', 0, 0, 10000, 0, false, false, false, false, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
