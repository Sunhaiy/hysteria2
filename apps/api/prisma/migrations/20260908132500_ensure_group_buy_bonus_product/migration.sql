INSERT INTO "CatalogProduct" (
  "id", "slug", "kind", "series", "status", "name", "description",
  "quotaCadence", "speedUpMbps", "speedDownMbps", "defaultTrafficMultiplierBasisPoints",
  "sortOrder", "featured", "homepageVisible", "requiresActivePlan", "referralEligible",
  "systemManaged", "createdAt", "updatedAt"
)
VALUES (
  'system_group_buy_traffic_bonus', 'system-group-buy-traffic-bonus',
  'TRAFFIC_PACK', 'STANDARD', 'DRAFT', '拼团赠送流量', '系统发放的拼团成功奖励',
  'ONE_TIME', 0, 0, 10000, 0, false, false, false, false, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "slug" = EXCLUDED."slug",
  "kind" = EXCLUDED."kind",
  "series" = EXCLUDED."series",
  "status" = EXCLUDED."status",
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "quotaCadence" = EXCLUDED."quotaCadence",
  "speedUpMbps" = EXCLUDED."speedUpMbps",
  "speedDownMbps" = EXCLUDED."speedDownMbps",
  "defaultTrafficMultiplierBasisPoints" = EXCLUDED."defaultTrafficMultiplierBasisPoints",
  "sortOrder" = EXCLUDED."sortOrder",
  "featured" = EXCLUDED."featured",
  "homepageVisible" = EXCLUDED."homepageVisible",
  "requiresActivePlan" = EXCLUDED."requiresActivePlan",
  "referralEligible" = EXCLUDED."referralEligible",
  "systemManaged" = EXCLUDED."systemManaged",
  "updatedAt" = CURRENT_TIMESTAMP;
