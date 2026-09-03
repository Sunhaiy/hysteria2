BEGIN;

CREATE TEMP TABLE "_StandardDiscountProductUrlSnapshot" ON COMMIT DROP AS
SELECT id, "storeUrl"
FROM "CatalogProduct"
WHERE kind = 'PLAN'
  AND series = 'STANDARD';

CREATE TEMP TABLE "_StandardDiscountOfferUrlSnapshot" ON COMMIT DROP AS
SELECT offer.id, offer."storeUrl"
FROM "CatalogOffer" AS offer
INNER JOIN "CatalogProduct" AS product ON product.id = offer."productId"
WHERE product.kind = 'PLAN'
  AND product.series = 'STANDARD';

DO $$
DECLARE
  active_products INTEGER;
  monthly_offers INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO active_products
  FROM "CatalogProduct"
  WHERE kind = 'PLAN'
    AND series = 'STANDARD'
    AND status = 'ACTIVE';

  SELECT COUNT(*)
  INTO monthly_offers
  FROM "CatalogOffer" AS offer
  INNER JOIN "CatalogProduct" AS product ON product.id = offer."productId"
  WHERE product.kind = 'PLAN'
    AND product.series = 'STANDARD'
    AND product.status = 'ACTIVE'
    AND offer."billingPeriod" = 'MONTHLY'
    AND offer.active = TRUE
    AND offer."archivedAt" IS NULL;

  IF active_products <> 9 OR monthly_offers <> 9 THEN
    RAISE EXCEPTION
      'Expected 9 active standard products and monthly offers, found % and %',
      active_products,
      monthly_offers;
  END IF;
END $$;

WITH monthly_prices AS (
  SELECT offer."productId", offer."priceCents"
  FROM "CatalogOffer" AS offer
  INNER JOIN "CatalogProduct" AS product ON product.id = offer."productId"
  WHERE product.kind = 'PLAN'
    AND product.series = 'STANDARD'
    AND product.status = 'ACTIVE'
    AND offer."billingPeriod" = 'MONTHLY'
    AND offer.active = TRUE
    AND offer."archivedAt" IS NULL
)
UPDATE "CatalogOffer" AS target
SET
  "priceCents" = CASE target."billingPeriod"
    WHEN 'QUARTERLY' THEN
      (monthly_prices."priceCents" * 3 * 95 + 50) / 100
    WHEN 'YEARLY' THEN
      (monthly_prices."priceCents" * 12 * 90 + 50) / 100
    ELSE target."priceCents"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM monthly_prices
WHERE target."productId" = monthly_prices."productId"
  AND target."billingPeriod" IN ('QUARTERLY', 'YEARLY')
  AND target.active = TRUE
  AND target."archivedAt" IS NULL;

UPDATE "PlanOffer" AS legacy_offer
SET
  "priceCents" = catalog_offer."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CatalogOffer" AS catalog_offer
INNER JOIN "CatalogProduct" AS product
  ON product.id = catalog_offer."productId"
WHERE legacy_offer.id = catalog_offer."legacyPlanOfferId"
  AND product.kind = 'PLAN'
  AND product.series = 'STANDARD'
  AND product.status = 'ACTIVE'
  AND catalog_offer."billingPeriod" IN ('QUARTERLY', 'YEARLY')
  AND catalog_offer.active = TRUE
  AND catalog_offer."archivedAt" IS NULL;

UPDATE "Plan" AS legacy_plan
SET
  "priceCents" = monthly_offer."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CatalogProduct" AS product
INNER JOIN "CatalogOffer" AS monthly_offer
  ON monthly_offer."productId" = product.id
  AND monthly_offer."billingPeriod" = 'MONTHLY'
  AND monthly_offer.active = TRUE
  AND monthly_offer."archivedAt" IS NULL
WHERE legacy_plan.id = product."legacyPlanId"
  AND product.kind = 'PLAN'
  AND product.series = 'STANDARD'
  AND product.status = 'ACTIVE';

DO $$
DECLARE
  mismatched_discounts INTEGER;
  mismatched_legacy_offers INTEGER;
  changed_product_urls INTEGER;
  changed_offer_urls INTEGER;
BEGIN
  WITH monthly_prices AS (
    SELECT offer."productId", offer."priceCents"
    FROM "CatalogOffer" AS offer
    INNER JOIN "CatalogProduct" AS product ON product.id = offer."productId"
    WHERE product.kind = 'PLAN'
      AND product.series = 'STANDARD'
      AND product.status = 'ACTIVE'
      AND offer."billingPeriod" = 'MONTHLY'
      AND offer.active = TRUE
      AND offer."archivedAt" IS NULL
  )
  SELECT COUNT(*)
  INTO mismatched_discounts
  FROM "CatalogOffer" AS target
  INNER JOIN monthly_prices ON monthly_prices."productId" = target."productId"
  WHERE target."billingPeriod" IN ('QUARTERLY', 'YEARLY')
    AND target.active = TRUE
    AND target."archivedAt" IS NULL
    AND target."priceCents" <> CASE target."billingPeriod"
      WHEN 'QUARTERLY' THEN
        (monthly_prices."priceCents" * 3 * 95 + 50) / 100
      WHEN 'YEARLY' THEN
        (monthly_prices."priceCents" * 12 * 90 + 50) / 100
      ELSE target."priceCents"
    END;

  SELECT COUNT(*)
  INTO mismatched_legacy_offers
  FROM "CatalogOffer" AS catalog_offer
  INNER JOIN "CatalogProduct" AS product ON product.id = catalog_offer."productId"
  INNER JOIN "PlanOffer" AS legacy_offer ON legacy_offer.id = catalog_offer."legacyPlanOfferId"
  WHERE product.kind = 'PLAN'
    AND product.series = 'STANDARD'
    AND product.status = 'ACTIVE'
    AND catalog_offer."billingPeriod" IN ('MONTHLY', 'QUARTERLY', 'YEARLY')
    AND catalog_offer.active = TRUE
    AND catalog_offer."archivedAt" IS NULL
    AND legacy_offer."priceCents" <> catalog_offer."priceCents";

  SELECT COUNT(*)
  INTO changed_product_urls
  FROM "_StandardDiscountProductUrlSnapshot" AS snapshot
  INNER JOIN "CatalogProduct" AS product ON product.id = snapshot.id
  WHERE product."storeUrl" IS DISTINCT FROM snapshot."storeUrl";

  SELECT COUNT(*)
  INTO changed_offer_urls
  FROM "_StandardDiscountOfferUrlSnapshot" AS snapshot
  INNER JOIN "CatalogOffer" AS offer ON offer.id = snapshot.id
  WHERE offer."storeUrl" IS DISTINCT FROM snapshot."storeUrl";

  IF mismatched_discounts <> 0 OR mismatched_legacy_offers <> 0 THEN
    RAISE EXCEPTION
      'Standard discount alignment failed: % catalog and % legacy mismatches',
      mismatched_discounts,
      mismatched_legacy_offers;
  END IF;

  IF changed_product_urls <> 0 OR changed_offer_urls <> 0 THEN
    RAISE EXCEPTION
      'Standard discount alignment changed % product URLs and % offer URLs',
      changed_product_urls,
      changed_offer_urls;
  END IF;
END $$;

COMMIT;
