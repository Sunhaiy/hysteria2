ALTER TABLE "EntitlementGrant"
ADD COLUMN "trafficMultiplierBasisPointsSnapshot" INTEGER;

ALTER TABLE "QuotaBucket"
ADD COLUMN "trafficMultiplierBasisPointsSnapshot" INTEGER;

ALTER TABLE "QuotaAdjustment"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "QuotaAdjustment_idempotencyKey_key"
ON "QuotaAdjustment"("idempotencyKey");

UPDATE "EntitlementGrant" AS grant
SET "trafficMultiplierBasisPointsSnapshot" = COALESCE(
  (
    SELECT orders."trafficMultiplierBasisPointsSnapshot"
    FROM "ManualOrder" AS orders
    WHERE orders."userId" = grant."userId"
      AND orders."catalogOfferId" = grant."offerId"
      AND orders."status" = 'APPLIED'
      AND orders."trafficMultiplierBasisPointsSnapshot" IS NOT NULL
    ORDER BY
      ABS(
        EXTRACT(
          EPOCH FROM (
            COALESCE(orders."processedAt", orders."createdAt") - grant."startsAt"
          )
        )
      ),
      orders."createdAt" DESC
    LIMIT 1
  ),
  CASE
    WHEN grant."kind" = 'PLAN'
      THEN account."trafficMultiplierBasisPoints"
    ELSE product."defaultTrafficMultiplierBasisPoints"
  END,
  product."defaultTrafficMultiplierBasisPoints",
  10000
)
FROM "AccessAccount" AS account, "CatalogProduct" AS product
WHERE account."id" = grant."accessAccountId"
  AND product."id" = grant."productId";

UPDATE "EntitlementGrant"
SET "trafficMultiplierBasisPointsSnapshot" = 10000
WHERE "trafficMultiplierBasisPointsSnapshot" IS NULL;

UPDATE "QuotaBucket" AS bucket
SET "trafficMultiplierBasisPointsSnapshot" = grant."trafficMultiplierBasisPointsSnapshot"
FROM "EntitlementGrant" AS grant
WHERE grant."id" = bucket."grantId";

UPDATE "QuotaBucket"
SET "trafficMultiplierBasisPointsSnapshot" = 10000
WHERE "trafficMultiplierBasisPointsSnapshot" IS NULL;

ALTER TABLE "EntitlementGrant"
ALTER COLUMN "trafficMultiplierBasisPointsSnapshot" SET DEFAULT 10000,
ALTER COLUMN "trafficMultiplierBasisPointsSnapshot" SET NOT NULL;

ALTER TABLE "QuotaBucket"
ALTER COLUMN "trafficMultiplierBasisPointsSnapshot" SET DEFAULT 10000,
ALTER COLUMN "trafficMultiplierBasisPointsSnapshot" SET NOT NULL;

ALTER TABLE "EntitlementGrant"
ADD CONSTRAINT "EntitlementGrant_trafficMultiplierBasisPointsSnapshot_check"
CHECK (
  "trafficMultiplierBasisPointsSnapshot" >= 1000 AND
  "trafficMultiplierBasisPointsSnapshot" <= 1000000
);

ALTER TABLE "QuotaBucket"
ADD CONSTRAINT "QuotaBucket_trafficMultiplierBasisPointsSnapshot_check"
CHECK (
  "trafficMultiplierBasisPointsSnapshot" >= 1000 AND
  "trafficMultiplierBasisPointsSnapshot" <= 1000000
);
