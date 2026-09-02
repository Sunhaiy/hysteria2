ALTER TABLE "EntitlementGrant"
ADD COLUMN "trafficMultiplierBasisPointsSnapshot" INTEGER NOT NULL DEFAULT 10000;

ALTER TABLE "QuotaBucket"
ADD COLUMN "trafficMultiplierBasisPointsSnapshot" INTEGER NOT NULL DEFAULT 10000;

ALTER TABLE "QuotaAdjustment"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "QuotaAdjustment_idempotencyKey_key"
ON "QuotaAdjustment"("idempotencyKey");

UPDATE "EntitlementGrant" AS entitlement
SET "trafficMultiplierBasisPointsSnapshot" = COALESCE(
  (
    SELECT orders."trafficMultiplierBasisPointsSnapshot"
    FROM "ManualOrder" AS orders
    WHERE orders."userId" = entitlement."userId"
      AND orders."catalogOfferId" = entitlement."offerId"
      AND orders."status" = 'APPLIED'
      AND orders."trafficMultiplierBasisPointsSnapshot" IS NOT NULL
    ORDER BY
      ABS(
        EXTRACT(
          EPOCH FROM (
            COALESCE(orders."processedAt", orders."createdAt") - entitlement."startsAt"
          )
        )
      ),
      orders."createdAt" DESC
    LIMIT 1
  ),
  CASE
    WHEN entitlement."kind" = 'PLAN'
      THEN account."trafficMultiplierBasisPoints"
    ELSE product."defaultTrafficMultiplierBasisPoints"
  END,
  product."defaultTrafficMultiplierBasisPoints",
  10000
)
FROM "AccessAccount" AS account, "CatalogProduct" AS product
WHERE account."id" = entitlement."accessAccountId"
  AND product."id" = entitlement."productId";

UPDATE "QuotaBucket" AS bucket
SET "trafficMultiplierBasisPointsSnapshot" = entitlement."trafficMultiplierBasisPointsSnapshot"
FROM "EntitlementGrant" AS entitlement
WHERE entitlement."id" = bucket."grantId";

ALTER TABLE "EntitlementGrant"
ADD CONSTRAINT "EntitlementGrant_trafficMultiplierBasisPointsSnapshot_check"
CHECK (
  "trafficMultiplierBasisPointsSnapshot" >= 1000 AND
  "trafficMultiplierBasisPointsSnapshot" <= 1000000
) NOT VALID;

ALTER TABLE "QuotaBucket"
ADD CONSTRAINT "QuotaBucket_trafficMultiplierBasisPointsSnapshot_check"
CHECK (
  "trafficMultiplierBasisPointsSnapshot" >= 1000 AND
  "trafficMultiplierBasisPointsSnapshot" <= 1000000
) NOT VALID;

ALTER TABLE "EntitlementGrant"
VALIDATE CONSTRAINT "EntitlementGrant_trafficMultiplierBasisPointsSnapshot_check";

ALTER TABLE "QuotaBucket"
VALIDATE CONSTRAINT "QuotaBucket_trafficMultiplierBasisPointsSnapshot_check";
