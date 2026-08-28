ALTER TABLE "Node"
  ADD COLUMN "portHoppingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "portHoppingStart" INTEGER,
  ADD COLUMN "portHoppingEnd" INTEGER,
  ADD COLUMN "portHoppingIntervalSeconds" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Node"
  ADD CONSTRAINT "Node_portHoppingRange_check"
  CHECK (
    ("portHoppingStart" IS NULL AND "portHoppingEnd" IS NULL)
    OR (
      "portHoppingStart" BETWEEN 1 AND 65535
      AND "portHoppingEnd" BETWEEN 1 AND 65535
      AND "portHoppingStart" < "portHoppingEnd"
      AND "portHoppingEnd" - "portHoppingStart" <= 20000
    )
  ),
  ADD CONSTRAINT "Node_portHoppingInterval_check"
  CHECK ("portHoppingIntervalSeconds" BETWEEN 5 AND 300),
  ADD CONSTRAINT "Node_portHoppingProtocol_check"
  CHECK (
    NOT "portHoppingEnabled"
    OR (
      "protocol" = 'HYSTERIA2'
      AND "portHoppingStart" IS NOT NULL
      AND "portHoppingEnd" IS NOT NULL
      AND NOT ("port" BETWEEN "portHoppingStart" AND "portHoppingEnd")
    )
  );
