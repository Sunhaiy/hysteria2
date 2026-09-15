-- Labels may mention top-tier service in an intermediate-tier warning.
-- Only a leading tier marker identifies a top-tier machine.
UPDATE "NodeServer" s SET "trafficMultiplierBasisPoints" = 10000
WHERE s."trafficMultiplierBasisPoints" = 20000
  AND s."name" !~ '^[[:space:]]*(\[|【)?顶级'
  AND NOT EXISTS (
    SELECT 1 FROM "Node" n WHERE n."serverId" = s.id
      AND n."label" ~ '^[[:space:]]*(\[|【)?顶级'
  );
