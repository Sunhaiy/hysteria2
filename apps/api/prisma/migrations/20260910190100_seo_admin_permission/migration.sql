INSERT INTO "AdminPermissionGrant" ("id", "userId", "permission", "createdAt")
SELECT 'seo_perm_' || substr(md5("id" || ':seo-content'), 1, 22), "id", 'SEO_CONTENT_MANAGE', CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'ADMIN'
ON CONFLICT ("userId", "permission") DO NOTHING;
