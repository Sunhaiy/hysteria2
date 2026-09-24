ALTER TABLE "RedemptionCode" ADD COLUMN "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RedemptionCode" ADD CONSTRAINT "RedemptionCode_maxUsesPerUser_positive" CHECK ("maxUsesPerUser" > 0);
ALTER TABLE "RedemptionUse" ADD COLUMN "useNumber" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "RedemptionUse_codeId_userId_useNumber_key" ON "RedemptionUse"("codeId", "userId", "useNumber");
DROP INDEX "RedemptionUse_codeId_userId_key";
