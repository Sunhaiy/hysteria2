ALTER TABLE "CatalogProduct"
ADD COLUMN "homepageVisible" BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked AS (
  SELECT
    product.id,
    ROW_NUMBER() OVER (
      ORDER BY product.featured DESC, product."sortOrder" ASC, product."createdAt" ASC
    ) AS position
  FROM "CatalogProduct" AS product
  WHERE product.kind = 'PLAN'
    AND product.series = 'STANDARD'
    AND product.status = 'ACTIVE'
    AND product."systemManaged" = FALSE
    AND EXISTS (
      SELECT 1
      FROM "CatalogOffer" AS offer
      WHERE offer."productId" = product.id
        AND offer.active = TRUE
        AND offer."archivedAt" IS NULL
    )
)
UPDATE "CatalogProduct" AS product
SET "homepageVisible" = TRUE
FROM ranked
WHERE product.id = ranked.id
  AND ranked.position <= 4;

CREATE INDEX "CatalogProduct_homepageVisible_status_sortOrder_idx"
ON "CatalogProduct"("homepageVisible", status, "sortOrder");
