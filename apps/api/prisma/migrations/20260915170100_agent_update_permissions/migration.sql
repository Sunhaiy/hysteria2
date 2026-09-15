INSERT INTO "AdminPermissionGrant" ("id", "userId", "permission", "createdAt")
SELECT 'agent-update-' || "id", "id", 'AGENT_UPDATES_MANAGE'::"AdminPermission", CURRENT_TIMESTAMP
FROM "User" WHERE "role" = 'ADMIN'
ON CONFLICT ("userId", "permission") DO NOTHING;
