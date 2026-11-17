-- Keep billing committed before acknowledgement. This marker means any
-- required disconnection work was durably queued, so ACK retries do not
-- repeatedly enqueue the same already-handled usage.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE "UsageImportBatch" ADD COLUMN "enforcementQueuedAt" TIMESTAMP(3);
COMMIT;
