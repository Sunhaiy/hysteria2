CREATE TYPE "PaymentFulfillmentStatus" AS ENUM (
  'PENDING',
  'APPLIED',
  'RETRYING',
  'REFUND_PENDING',
  'REFUNDED',
  'MANUAL_REVIEW'
);

ALTER TABLE "EpayPaymentAttempt"
  ADD COLUMN "fulfillmentStatus" "PaymentFulfillmentStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "EpayPaymentAttempt"
SET "fulfillmentStatus" = CASE
  WHEN "orderId" IS NOT NULL THEN 'APPLIED'::"PaymentFulfillmentStatus"
  WHEN "settlementFailureCount" > 0 THEN 'RETRYING'::"PaymentFulfillmentStatus"
  ELSE 'PENDING'::"PaymentFulfillmentStatus"
END;

ALTER TABLE "EpayRefundAttempt"
  ADD COLUMN "reasonCode" TEXT;

ALTER TABLE "GroupBuyMember"
  ADD COLUMN "rebateRecoveredCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rebateUnrecoveredCents" INTEGER NOT NULL DEFAULT 0;

UPDATE "ManualOrder" AS orders
SET "entitlementGrantId" = (
  SELECT grants."id"
  FROM "EntitlementGrant" AS grants
  JOIN "CatalogOffer" AS offers ON offers."productId" = grants."productId"
  WHERE offers."id" = orders."catalogOfferId"
    AND grants."userId" = orders."userId"
    AND grants."startsAt" <= COALESCE(orders."processedAt", orders."createdAt")
    AND grants."endsAt" >= COALESCE(orders."processedAt", orders."createdAt")
  ORDER BY
    ABS(EXTRACT(EPOCH FROM (
      grants."createdAt" - COALESCE(orders."processedAt", orders."createdAt")
    ))) ASC,
    grants."id" ASC
  LIMIT 1
)
WHERE orders."entitlementGrantId" IS NULL
  AND orders."status" = 'APPLIED'
  AND orders."catalogOfferId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "EntitlementGrant" AS grants
    JOIN "CatalogOffer" AS offers ON offers."productId" = grants."productId"
    WHERE offers."id" = orders."catalogOfferId"
      AND grants."userId" = orders."userId"
      AND grants."startsAt" <= COALESCE(orders."processedAt", orders."createdAt")
      AND grants."endsAt" >= COALESCE(orders."processedAt", orders."createdAt")
  );

CREATE INDEX "EpayPaymentAttempt_fulfillmentStatus_updatedAt_id_idx"
  ON "EpayPaymentAttempt"("fulfillmentStatus", "updatedAt", "id");

CREATE INDEX "GroupBuyMember_rebateUnrecoveredCents_updatedAt_id_idx"
  ON "GroupBuyMember"("rebateUnrecoveredCents", "updatedAt", "id");
