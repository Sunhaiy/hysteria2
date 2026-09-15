ALTER TABLE "NodeServer" ADD COLUMN "trafficMultiplierBasisPoints" INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "NodeServer" ADD CONSTRAINT "NodeServer_trafficMultiplierBasisPoints_check" CHECK ("trafficMultiplierBasisPoints" BETWEEN 1000 AND 1000000);

-- Shared protocol endpoints use one machine rate. Existing usage stays immutable.
UPDATE "NodeServer" s SET "trafficMultiplierBasisPoints" = 20000
WHERE s."name" LIKE '%顶级%' OR EXISTS (
  SELECT 1 FROM "Node" n WHERE n."serverId" = s.id AND n."label" LIKE '%顶级%'
);
