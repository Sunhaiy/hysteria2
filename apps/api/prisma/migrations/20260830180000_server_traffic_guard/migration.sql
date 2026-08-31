ALTER TABLE "NodeServer"
  ADD COLUMN "trafficLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trafficLimitBytes" BIGINT,
  ADD COLUMN "trafficLimitResetDay" INTEGER NOT NULL DEFAULT 1;

UPDATE "NodeServer" AS server
SET
  "trafficLimitEnabled" = source."trafficLimitEnabled",
  "trafficLimitBytes" = source."trafficLimitBytes",
  "trafficLimitResetDay" = source."trafficLimitResetDay"
FROM (
  SELECT
    "serverId",
    BOOL_OR(
      "trafficLimitEnabled" = true AND "trafficLimitBytes" IS NOT NULL
    ) AS "trafficLimitEnabled",
    MIN("trafficLimitBytes") FILTER (
      WHERE "trafficLimitEnabled" = true AND "trafficLimitBytes" IS NOT NULL
    ) AS "trafficLimitBytes",
    MIN("trafficLimitResetDay") FILTER (
      WHERE "trafficLimitEnabled" = true AND "trafficLimitBytes" IS NOT NULL
    ) AS "trafficLimitResetDay"
  FROM "Node"
  WHERE "serverId" IS NOT NULL
  GROUP BY "serverId"
) AS source
WHERE server."id" = source."serverId"
  AND source."trafficLimitEnabled" = true;

ALTER TABLE "NodeServer"
  ADD CONSTRAINT "NodeServer_trafficLimitBytes_check"
  CHECK ("trafficLimitBytes" IS NULL OR "trafficLimitBytes" > 0),
  ADD CONSTRAINT "NodeServer_enabledTrafficLimit_check"
  CHECK ("trafficLimitEnabled" = false OR "trafficLimitBytes" IS NOT NULL),
  ADD CONSTRAINT "NodeServer_trafficLimitResetDay_check"
  CHECK ("trafficLimitResetDay" BETWEEN 1 AND 28);
