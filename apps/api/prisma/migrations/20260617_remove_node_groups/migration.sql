-- Migration: remove NodeGroup layer, plans bind directly to nodes

-- 1. Add nodeId to Subscription (nullable first for data migration)
ALTER TABLE "Subscription" ADD COLUMN "nodeId" TEXT;

-- 2. Fill nodeId from first node in each subscription's node group
UPDATE "Subscription" s
SET "nodeId" = (
  SELECT n.id FROM "Node" n
  WHERE n."nodeGroupId" = s."nodeGroupId"
  AND n.active = true
  ORDER BY n."createdAt" ASC
  LIMIT 1
);
-- Fallback: any node in the group
UPDATE "Subscription" s
SET "nodeId" = (
  SELECT n.id FROM "Node" n
  WHERE n."nodeGroupId" = s."nodeGroupId"
  ORDER BY n."createdAt" ASC
  LIMIT 1
)
WHERE s."nodeId" IS NULL;

-- 3. Add nodeId to PlanBinding (nullable first)
ALTER TABLE "PlanBinding" ADD COLUMN "nodeId" TEXT;

-- 4. Fill nodeId from first node in each binding's node group
UPDATE "PlanBinding" pb
SET "nodeId" = (
  SELECT n.id FROM "Node" n
  WHERE n."nodeGroupId" = pb."nodeGroupId"
  ORDER BY n."createdAt" ASC
  LIMIT 1
);

-- 5. Make nodeId NOT NULL on both tables
ALTER TABLE "Subscription" ALTER COLUMN "nodeId" SET NOT NULL;
ALTER TABLE "PlanBinding" ALTER COLUMN "nodeId" SET NOT NULL;

-- 6. Add FK constraints for new nodeId columns
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanBinding" ADD CONSTRAINT "PlanBinding_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Drop old unique constraint on PlanBinding and add new one
ALTER TABLE "PlanBinding" DROP CONSTRAINT "PlanBinding_planId_nodeGroupId_key";
ALTER TABLE "PlanBinding" ADD CONSTRAINT "PlanBinding_planId_nodeId_key" UNIQUE ("planId", "nodeId");

-- 8. Drop old FK constraints
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_nodeGroupId_fkey";
ALTER TABLE "PlanBinding" DROP CONSTRAINT "PlanBinding_nodeGroupId_fkey";
ALTER TABLE "Node" DROP CONSTRAINT "Node_nodeGroupId_fkey";

-- 9. Drop old columns
ALTER TABLE "Subscription" DROP COLUMN "nodeGroupId";
ALTER TABLE "PlanBinding" DROP COLUMN "nodeGroupId";
ALTER TABLE "Node" DROP COLUMN "nodeGroupId";

-- 10. Drop NodeGroup table (all FKs removed above)
DROP TABLE "NodeGroup";
