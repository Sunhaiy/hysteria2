-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'PAUSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TrafficPackStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'APPLIED', 'VOID');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('RENEWAL', 'TRAFFIC_PACK', 'MANUAL_CREDIT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trafficBytes" BIGINT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "speedUpMbps" INTEGER NOT NULL,
    "speedDownMbps" INTEGER NOT NULL,
    "deviceLimit" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "accent" TEXT NOT NULL DEFAULT 'green',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeGroup" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "nodeGroupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "obfsPassword" TEXT,
    "sni" TEXT,
    "pinSHA256" TEXT,
    "allowInsecureTls" BOOLEAN NOT NULL DEFAULT false,
    "trafficApiBaseUrl" TEXT NOT NULL,
    "trafficApiSecret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "speedUpMbps" INTEGER NOT NULL,
    "speedDownMbps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanBinding" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "nodeGroupId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "nodeGroupId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "includedTrafficBytes" BIGINT NOT NULL,
    "bonusTrafficBytes" BIGINT NOT NULL DEFAULT 0,
    "consumedTrafficBytes" BIGINT NOT NULL DEFAULT 0,
    "speedUpMbpsSnapshot" INTEGER NOT NULL,
    "speedDownMbpsSnapshot" INTEGER NOT NULL,
    "deviceLimitSnapshot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficPack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "totalBytes" BIGINT NOT NULL,
    "remainingBytes" BIGINT NOT NULL,
    "status" "TrafficPackStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "processedById" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "kind" "OrderKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "durationDays" INTEGER,
    "trafficBytes" BIGINT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ManualOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "accessTokenId" TEXT,
    "nodeId" TEXT,
    "granted" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "remoteAddr" TEXT,
    "requestedTxBps" INTEGER,
    "submittedTokenPreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRollup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "txBytes" BIGINT NOT NULL,
    "rxBytes" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "concurrentClients" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnlineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AccessToken_token_key" ON "AccessToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "NodeGroup_slug_key" ON "NodeGroup"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Node_label_key" ON "Node"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Node_hostname_port_key" ON "Node"("hostname", "port");

-- CreateIndex
CREATE UNIQUE INDEX "PlanBinding_planId_nodeGroupId_key" ON "PlanBinding"("planId", "nodeGroupId");

-- CreateIndex
CREATE INDEX "UsageRollup_userId_bucketStart_idx" ON "UsageRollup"("userId", "bucketStart");

-- CreateIndex
CREATE INDEX "OnlineSnapshot_userId_capturedAt_idx" ON "OnlineSnapshot"("userId", "capturedAt");

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_nodeGroupId_fkey" FOREIGN KEY ("nodeGroupId") REFERENCES "NodeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBinding" ADD CONSTRAINT "PlanBinding_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBinding" ADD CONSTRAINT "PlanBinding_nodeGroupId_fkey" FOREIGN KEY ("nodeGroupId") REFERENCES "NodeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_nodeGroupId_fkey" FOREIGN KEY ("nodeGroupId") REFERENCES "NodeGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficPack" ADD CONSTRAINT "TrafficPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficPack" ADD CONSTRAINT "TrafficPack_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualOrder" ADD CONSTRAINT "ManualOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualOrder" ADD CONSTRAINT "ManualOrder_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "AccessToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRollup" ADD CONSTRAINT "UsageRollup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRollup" ADD CONSTRAINT "UsageRollup_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRollup" ADD CONSTRAINT "UsageRollup_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineSnapshot" ADD CONSTRAINT "OnlineSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineSnapshot" ADD CONSTRAINT "OnlineSnapshot_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
