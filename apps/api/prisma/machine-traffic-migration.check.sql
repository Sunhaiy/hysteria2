\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE "NodeServer" (id TEXT PRIMARY KEY, "name" TEXT);
CREATE TEMP TABLE "Node" ("serverId" TEXT, "label" TEXT);
INSERT INTO "NodeServer" VALUES ('top', '[顶级]美国'), ('middle', '[中级]日本'), ('protocol', 'US Server'), ('ordinary', '普通');
INSERT INTO "Node" VALUES ('protocol', '[顶级]美国 VLESS'), ('protocol', '美国 Hysteria2');
INSERT INTO "Node" VALUES ('middle', '[中级]非特殊情况，请用顶级线路');
\ir migrations/20260915090000_machine_traffic_multiplier/migration.sql
\ir migrations/20260915093000_machine_tier_classification/migration.sql
DO $$
BEGIN
  IF (SELECT "trafficMultiplierBasisPoints" FROM "NodeServer" WHERE id = 'top') <> 20000
     OR (SELECT "trafficMultiplierBasisPoints" FROM "NodeServer" WHERE id = 'protocol') <> 20000
     OR (SELECT "trafficMultiplierBasisPoints" FROM "NodeServer" WHERE id = 'middle') <> 10000
     OR (SELECT "trafficMultiplierBasisPoints" FROM "NodeServer" WHERE id = 'ordinary') <> 10000 THEN
    RAISE EXCEPTION 'Incorrect machine rate backfill';
  END IF;
  BEGIN
    UPDATE "NodeServer" SET "trafficMultiplierBasisPoints" = 0 WHERE id = 'top';
    RAISE EXCEPTION 'Rate constraint did not reject zero';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
ROLLBACK;
