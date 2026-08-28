ALTER TABLE "Node"
  ADD COLUMN "trafficLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trafficLimitBytes" BIGINT,
  ADD COLUMN "trafficLimitResetDay" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Node"
  ADD CONSTRAINT "Node_trafficLimitBytes_check"
  CHECK ("trafficLimitBytes" IS NULL OR "trafficLimitBytes" > 0),
  ADD CONSTRAINT "Node_trafficLimitResetDay_check"
  CHECK ("trafficLimitResetDay" BETWEEN 1 AND 28);
