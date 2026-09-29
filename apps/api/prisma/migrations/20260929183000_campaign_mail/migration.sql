CREATE TABLE "CampaignMailJob" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "inputHash" TEXT NOT NULL,
  "audience" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CampaignMailJob_actorId_idempotencyKey_key" ON "CampaignMailJob"("actorId", "idempotencyKey");
CREATE INDEX "CampaignMailJob_status_createdAt_idx" ON "CampaignMailJob"("status", "createdAt");
CREATE TABLE "CampaignMailDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "error" TEXT,
  CONSTRAINT "CampaignMailDelivery_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CampaignMailJob"("id") ON DELETE CASCADE,
  CONSTRAINT "CampaignMailDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "CampaignMailDelivery_jobId_userId_key" ON "CampaignMailDelivery"("jobId", "userId");
CREATE INDEX "CampaignMailDelivery_status_jobId_idx" ON "CampaignMailDelivery"("status", "jobId");
CREATE TABLE "CampaignMailOptOut" (
  "userId" TEXT NOT NULL PRIMARY KEY, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignMailOptOut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
