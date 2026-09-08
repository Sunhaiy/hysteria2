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
- `POST /api/portal/payments/epay` accepts
  `{ offerId, paymentType: "alipay" | "wxpay" }`, requires an
  `Idempotency-Key` header, and is available only while 易支付 is the active
  checkout channel.
- `GET /api/payments/epay/notify` and `POST /api/payments/epay/notify` accept
  signed gateway callbacks. Existing attempts continue using their credential
  and entitlement snapshots after checkout-channel or merchant-key changes.
- `POST /api/admin/payments/epay/tests` creates a real ¥0.01 administrator
  gateway test while the site remains in store mode. Its dedicated notify and
  return callbacks only mark the test attempt as settled; they never create a
  customer order or entitlement. `GET /api/admin/payments/epay/tests/latest`
  reports separate Alipay and WeChat Pay results. Both channels must pass for
  the current credentials before activation.
- `GET /api/admin/orders`, `/api/admin/orders/:id`,
  `/api/admin/orders/payment-attempts`, and `/api/admin/orders/summary` provide
  the paginated order center, payment exceptions, and Asia/Shanghai daily and
  month-to-date net revenue. The exception view includes paid attempts whose
  entitlement is retrying, awaiting compensation refund, or requires manual
  review. Compensation refunds expose their reason code and retry state.
- `GET /api/portal/check-ins/today` and `POST /api/portal/check-ins/claim`
  expose the idempotent daily reward. `GET /api/admin/check-ins`,
  `GET /api/admin/check-ins/settings`, and
  `PATCH /api/admin/check-ins/settings` provide paginated audit and
  configuration.
- `GET /api/portal/group-buys/campaigns`, `GET /api/portal/group-buys`, and
  `GET /api/portal/group-buys/:idOrCode` expose member group-buy state and
  share-code lookup. `POST /api/portal/group-buys/:id/cancel` lets only the
  creator cancel an open balance-rebate group before another member starts
  joining. Cancellation retains the already activated plan, releases the
  creator's active group slot, and grants neither rebate nor bonus traffic.
  `POST /api/portal/group-buys` and
  `POST /api/portal/group-buys/:id/join` accept optional
  `planActivation=scheduled_switch|immediate_switch`. The server ignores that
  preference for first purchases and same-plan renewals; different plans
  default to scheduled activation. Every member receives the base plan as soon
  as payment settles, while rebate and bonus traffic still require the group to
  complete. An account with an existing scheduled plan may only buy a current
  cycle traffic reset until that plan starts.
  `GET /api/admin/group-buys`, `PUT /api/admin/group-buys/campaigns`,
  `POST /api/admin/group-buys/refunds/:id/retry`, and
  `POST /api/admin/group-buys/members/:id/retry-fulfillment` provide activity
  configuration and explicit exception recovery. Pass
  `exceptionsOnly=true` to the group list to include refund, fulfillment, and
  unrecovered balance-rebate debt exceptions only.
- `GET /api/portal/anniversary-gift` reports the signed-in member's first-year
  eligibility and configured gift. `POST /api/portal/anniversary-gift/claim`
  grants it once through a complimentary, idempotent order. Gift orders do not
  create payment records and are excluded from recognized revenue.
- The single sync worker can reconcile missing callbacks through the merchant
  query endpoint derived from each attempt's immutable gateway snapshot. Set
  `EPAY_RECONCILIATION_ENABLED=true` only after a real signed query succeeds.
  The worker verifies the response signature and exact order number, amount,
  channel, and status before using the same atomic settlement entry point as a
  callback. `PENDING` remains open, signed `CLOSED` releases the active purchase
  key, and `code=-1`, transport failures, or invalid responses never credit an
  order. Query timestamps and sanitized failures are visible in the order
  center.
- `DELETE /api/admin/traffic-pack-products/:id` archives a product and preserves all order/CDK references.

Legacy purchase routes remain compatibility adapters for one version. New clients must use the commerce routes.

## Reporting and member alerts

- `GET /api/admin/reporting/summary` returns wallet revenue, CDK entitlement value, order completion, node availability, sync delay, and pending usage batches.
- `GET /api/admin/reporting/orders.csv` exports the immutable order terms and operator trail as UTF-8 CSV.
- Member overview responses include the highest crossed traffic threshold at 80%, 95%, or 100%, plus a separate warning within three days of subscription expiry.
- Reporting recognizes only fulfilled `PAYMENT` orders as revenue. Wallet,
  CDK, administrator, legacy, and gateway-test rows are excluded; applied
  refunds reduce the same payment-only total.

## Migration impact

Migration `20260814130000_public_commerce_hardening`:

- permanently drops recoverable plaintext passwords;
- adds session revocation versions, encrypted-setting support, one-time reset tokens, and audit logs;
- adds immutable order terms, product-bound traffic CDKs, product archives, and checkout idempotency;
- adds durable usage-import batches and links usage rollups to their source batch.

Run `prisma migrate deploy` before starting the new API. Back up PostgreSQL first. Existing orders are retained with source `LEGACY`; no historical order, redemption, or usage row is deleted.

## Node traffic protocol

VLESS/Xray agents use `POST /traffic/claim` followed by `POST /traffic/ack`. A failed control-plane apply must retry the same batch ID. Hysteria's native fallback performs a single read-and-clear request but cannot guarantee recovery from a lost response; public billing requires a durable node adapter with claim/apply/ack semantics.

## External payment operations

易支付 settlement uses an immutable payment attempt, MD5 callback signature
verification, exact integer-cent matching, a serializable fulfillment
transaction, and a unique gateway trade number. A verified callback with a
retryable failure returns `fail` so the gateway can retry. A verified payment
that is no longer fulfillable is settled as paid and queued for an automatic
full compensation refund using its credential snapshot. An old attempt without
a complete snapshot never falls back to current merchant credentials and enters
manual review. Operators must monitor fulfillment, refund, and query states in
the order center. Full-site 易支付 activation remains blocked unless
`EPAY_RECONCILIATION_ENABLED=true`; setting the flag starts the worker adapter
but does not switch the site away from store checkout.

## Backup and restore rehearsal

Application-managed `.h2backup` archives include an exact database migration
version. Import and isolated restore validation reject older or newer schemas
before maintenance mode or any live database replacement. Scheduled backups
retain the newest three by default; manual, imported, and pre-restore safety
backups are not removed by scheduled retention.

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

## Traffic multiplier reconciliation

After deploying the entitlement multiplier migration, first inspect historical
traffic-pack undercharges without writing data. The cutoff must be the UTC time
at which the fixed API and worker became active:

```bash
pnpm --filter @hysteria/api prisma:reconcile-traffic-multipliers -- --cutoff=2026-09-02T10:30:00Z
```

Apply only after comparing the candidate users and byte deltas with the
read-only production audit:

```bash
TRAFFIC_MULTIPLIER_RECONCILE_CONFIRM=apply-reviewed-undercharges \
pnpm --filter @hysteria/api prisma:reconcile-traffic-multipliers -- \
  --cutoff=2026-09-02T10:30:00Z --apply
```

The command only reconciles pre-cutoff allocations recorded at exactly `1x`.
It writes an idempotent `QuotaAdjustment` and audit event, never changes a
historical `UsageRollup`, and cannot reduce remaining quota below zero.
