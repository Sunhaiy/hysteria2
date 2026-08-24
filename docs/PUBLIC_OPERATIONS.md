# Public Operations

## Production prerequisites

- PostgreSQL backups must run automatically and restores must be rehearsed on a separate database.
- Redis is mandatory in `NODE_ENV=production`; startup fails when `REDIS_URL` is absent or unreachable.
- Set a random `JWT_SECRET` and a base64-encoded 32-byte `SETTINGS_ENCRYPTION_KEY` before the first production start.
- Set `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, and `CORS_ORIGINS` to the HTTPS public origins. Browser sessions use HttpOnly, Secure, SameSite cookies in production.
- Set `SMTP_REQUIRED=true` when registration or operational email is required.
- Use `/api/health/live` for liveness and `/api/health/ready` for readiness.

Generate an encryption key with:

```bash
openssl rand -base64 32
```

## Commerce interface

- `POST /api/portal/commerce/quote` accepts `{ kind: "plan" | "traffic_pack", productId, discountCode? }`.
- `POST /api/portal/commerce/checkout` accepts the same body and requires an `Idempotency-Key` header.
- `POST /api/portal/commerce/redeem` accepts `{ code, expectedTrafficPackProductId? }`.
- `DELETE /api/admin/traffic-pack-products/:id` archives a product and preserves all order/CDK references.

Legacy purchase routes remain compatibility adapters for one version. New clients must use the commerce routes.

## Reporting and member alerts

- `GET /api/admin/reporting/summary` returns wallet revenue, CDK entitlement value, order completion, node availability, sync delay, and pending usage batches.
- `GET /api/admin/reporting/orders.csv` exports the immutable order terms and operator trail as UTF-8 CSV.
- Member overview responses include the highest crossed traffic threshold at 80%, 95%, or 100%, plus a separate warning within three days of subscription expiry.
- Refund and payment metrics intentionally report as unavailable until a real payment gateway and refund ledger exist.

## Migration impact

Migration `20260814130000_public_commerce_hardening`:

- permanently drops recoverable plaintext passwords;
- adds session revocation versions, encrypted-setting support, one-time reset tokens, and audit logs;
- adds immutable order terms, product-bound traffic CDKs, product archives, and checkout idempotency;
- adds durable usage-import batches and links usage rollups to their source batch.

Run `prisma migrate deploy` before starting the new API. Back up PostgreSQL first. Existing orders are retained with source `LEGACY`; no historical order, redemption, or usage row is deleted.

## Node traffic protocol

VLESS/Xray agents use `POST /traffic/claim` followed by `POST /traffic/ack`. A failed control-plane apply must retry the same batch ID. Hysteria's native fallback performs a single read-and-clear request but cannot guarantee recovery from a lost response; public billing requires a durable node adapter with claim/apply/ack semantics.

## Deferred payment operations

The first release intentionally supports wallet and product-bound CDK only. A real payment gateway still requires `PaymentAttempt`, signed idempotent callbacks, refunds, reconciliation, and an exception-order console before it can be enabled.

## Backup and restore rehearsal

Install PostgreSQL client tools on the operations host, set `DATABASE_URL`, and schedule the backup script with Windows Task Scheduler:

```powershell
powershell -NoProfile -File .\ops\backup\postgres-backup.ps1 -BackupDirectory D:\hysteria2-backups -RetentionDays 14
```

At least monthly, restore the newest dump into an isolated temporary database. The verification script creates a uniquely named database, checks that application tables exist, and removes only that temporary database:

```powershell
powershell -NoProfile -File .\ops\backup\postgres-restore-check.ps1 `
  -BackupFile D:\hysteria2-backups\hysteria2-YYYYMMDD-HHMMSS.dump `
  -MaintenanceDatabaseUrl postgresql://postgres:password@127.0.0.1:5432/postgres
```

Backups are not complete until an off-host copy is encrypted, retained, and a restore rehearsal has succeeded.
