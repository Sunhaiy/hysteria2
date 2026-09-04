ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "User_deletedAt_role_status_createdAt_id_idx"
ON "User"("deletedAt", "role", "status", "createdAt", "id");
