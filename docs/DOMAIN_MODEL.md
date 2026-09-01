# Control plane domain model

This document defines the terms used by control-plane code, database models,
HTTP interfaces, migrations, and tests. New code should use these terms rather
than adding another interpretation to the legacy plan and pool models.

## Catalog and access

- **CatalogProduct** is the customer-visible product. It is either a recurring
  plan or a one-time traffic pack.
- **CatalogOffer** is one purchasable billing period and price for a product.
  Monthly, quarterly, and yearly offers use fixed intervals of 1, 3, and 12
  months. An offer owns the traffic, price, and external store link for that
  period. The product store link is a compatibility fallback.
- **AccessProfile** is the access policy granted by a product. It owns speed,
  device, and directly bound node priorities.
- **NodeServer** is one physical or virtual server.
- **Node** is one protocol endpoint on a server. Hysteria2 and VLESS + Reality
  endpoints are separate nodes even when they share a server.
- A `NodeServer` owns the monthly physical-traffic protection policy. Its usage
  is the sum of all endpoint rollups; reaching the limit disables the server and
  its endpoints before queuing per-endpoint runtime stops.
- **AccessProfileNode** is the direct, prioritized relationship between an
  access profile and a protocol endpoint.

`Plan`, `PlanOffer`, `TrafficPackProduct`, `NodePool`, `NodePoolMember`, and
`AccessProfilePool` are compatibility models. They remain readable for one
stability window, but they do not receive new business rules.

## Entitlements and usage

- **EntitlementGrant** is the immutable record that a product was successfully
  granted to a customer for a bounded period.
- **QuotaBucket** is spendable traffic owned by one grant. Recurring plan
  buckets reset monthly from the subscription anchor; traffic-pack buckets are
  one-time.
- **QuotaAdjustment** is an immutable operator ledger entry. It records actor,
  reason, target bucket, and before/after values without rewriting usage.
- **UsageImportBatch** is the idempotency seam between a node worker and quota
  accounting.
- **UsageRollup** is an immutable accounted usage record. The traffic multiplier
  is applied when the batch is saved; old rollups are never recalculated.

## Operations

- **OnlinePresence** is the current `(user, node)` online projection. It contains
  connection count and observation time, never a client IP. Data older than 45
  seconds is stale. Connection count is not a unique-device count: one Clash or
  Hysteria2 client can open sessions on several nodes for health checks,
  failover, and concurrent requests. UIs must not label this projection as
  devices or use it to deny access. `deviceLimit` remains a compatibility
  snapshot for old releases, but current Hysteria2 and VLESS access is not
  device-limited.
- **NodeHealthSnapshot** records one protocol-aware probe result. The latest row
  is the current health projection; older rows are retained only for bounded
  operational history.
- **MonitorAlert** is a deduplicated alert state machine. Two failing checks open
  an alert and two successful checks resolve it.
- **NodeRuntimeCommand** is a durable, idempotent request for the worker to
  query, start, or stop one endpoint service. Its success state always comes
  from the node agent, never from the requested target state.

`Node.lifecycleStatus` is the access lifecycle. `Node.runtimeState` is the
observed systemd state. Disabling access does not stop a service; stopping a
service does not silently rewrite access policy.

Deleting a server or node from the operations UI is a **retirement**, not a
physical database delete. A confirmed server deletion immediately disables and
retires the server and every endpoint, while durable stop commands disconnect
any running services. Retired topology is excluded from subscriptions, worker
polling, and current operations views, while immutable usage, cost, and audit
history remains queryable.

The API process serves projections only. The standalone worker owns full sync,
online collection, health probing, and manual-check consumption.

## Commerce and finance

- **ManualOrder** is the order compatibility ledger. Revenue is recognized only
  after its entitlement is applied.
- **EpayPaymentAttempt** is a signed external-payment intent. It snapshots the
  gateway credentials and entitlement terms used when the intent was created,
  so later settings or catalog edits cannot invalidate or alter settlement.
  Verified callbacks are idempotent. Fulfillment failures remain retryable and
  record their reason and attempt count for reconciliation.
- **EpayGatewayTestAttempt** is an administrator-initiated ¥0.01 gateway probe.
  It snapshots the credentials and callback contract but never creates an
  order, payment record, revenue, subscription, entitlement, or traffic pack.
  Enabling 易支付 requires a settled test for the current credential
  fingerprint; changing the gateway, merchant, key, or default payment type
  requires another test.
- A complimentary admin grant records the offer list price and an equal
  discount, with zero charged revenue.
- A plan CDK references a concrete `CatalogOffer`. Its revenue snapshot is the
  offer price at redemption; `amountCents` is only meaningful for wallet codes.
- A plan CDK uses `RENEW` to extend the same current plan or `REPLACE` to start
  its bound offer immediately and reset the base plan entitlement.
- **Refund** reduces recognized revenue. It does not rewrite the entitlement or
  historical usage ledger.

## Tutorials

- **TutorialGuide** is the stable platform entry.
- **TutorialRevision** is a draft, published, or archived version.
- **TutorialStep** is ordered text with an optional image.
- **TutorialImage** is a validated JPEG/PNG/WebP upload stored as responsive
  WebP assets.

Publishing is atomic: archive the previous published revision, publish the
draft, and switch the guide pointer in one database transaction.

## Support

- **SupportTicket** is a member-owned support case and status projection.
- **SupportTicketMessage** is an immutable member or staff reply.
- Member activity waits for staff; staff activity waits for the member. Closed
  tickets reject new replies until an administrator reopens them.

## Referrals

- **ReferralCode** is a member's stable eight-character invitation identity.
  Ambiguous characters are excluded, and members cannot rotate their code.
- **ReferralAttribution** is the immutable inviter/invitee ownership captured
  during email verification registration. One invitee can have only one
  attribution, and OAuth never creates one.
- A pending attribution qualifies only when the invitee's first plan CDK
  successfully grants a plan entitlement. Wallet checkout, traffic-pack and
  balance CDKs, discounts, and complimentary admin grants do not qualify.
- The inviter reward and invitee traffic amount are snapshots on the
  attribution. The traffic reward is a system-managed traffic-pack entitlement
  with the qualifying plan's access profile and expiry.
- Any applied refund on the qualifying order reverses the reward once. Wallet
  recovery stops at zero and records the unrecovered amount; canceling the
  bonus grant preserves consumed traffic and immutable usage allocations.

## Module seams

- `CatalogService`: catalog products, offers, access profiles, portal catalog.
- `EntitlementService`: grants, quota buckets, access resolution, usage batches.
- `CustomerAdminService`: customer search and lazy detail views.
- `NodeOpsService` and `OperationsService`: server topology and live operations.
- `FinanceService`: paged ledgers and database-aggregated reporting.
- `TutorialsService`: drafts, assets, publication, and published guides.
- `ReferralService`: stable codes, read models, transactional settlement, and
  conservative refund reversal.
- `MemberOnboardingService`: atomic member, access identity, and optional email
  referral attribution creation.
- `ControlPlaneStoreService`: legacy compatibility adapter only. Do not add new
  business behavior to this module.

Tests cross these interfaces. Database, Redis, node agents, SMTP, and image
storage are adapters at external seams; private helpers are not test surfaces.
