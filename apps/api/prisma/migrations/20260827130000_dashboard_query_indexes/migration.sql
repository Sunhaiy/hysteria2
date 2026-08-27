CREATE INDEX "AuthEvent_createdAt_granted_idx"
  ON "AuthEvent"("createdAt", "granted");

CREATE INDEX "DestinationImportBatch_observedAt_idx"
  ON "DestinationImportBatch"("observedAt");

CREATE INDEX "Subscription_status_idx"
  ON "Subscription"("status");

CREATE INDEX "EntitlementGrant_kind_status_startsAt_endsAt_userId_idx"
  ON "EntitlementGrant"("kind", "status", "startsAt", "endsAt", "userId");
