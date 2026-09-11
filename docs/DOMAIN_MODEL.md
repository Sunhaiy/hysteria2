# Control plane domain model

This document defines the terms used by control-plane code, database models,
HTTP interfaces, migrations, and tests. New code should use these terms rather
than adding another interpretation to the legacy plan and pool models.

## Catalog and access

- **CatalogProduct** is the customer-visible product. It is either a recurring
  plan or a one-time traffic pack.
- **Ultra catalog series** is an additive permanent purchase with monthly-reset
  quota. Its three tiers share one exclusive access profile and never replace a
  member's standard plan.
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

- **EntitlementGrant** is the durable record that a product was successfully
  granted to a customer for a bounded period. Purchased price, traffic,
  cadence, reset anchor, and multiplier snapshots are contractual. Revocation
  changes lifecycle state and end time but never rewrites consumed usage.
  Explicit administrator changes to an active product's access profile may
  propagate speed and node-access snapshots through `EntitlementService`.
- **QuotaBucket** is spendable traffic owned by one grant. Recurring plan
  buckets reset monthly from the subscription anchor; traffic-pack buckets are
  normally one-time. Ultra traffic-pack grants also reset monthly from their
  first-purchase anchor. Each bucket freezes the multiplier used for its own
  consumption so a later renewal cannot alter an existing bucket's billing.
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
- **WalletLedgerEntry** is the authoritative immutable balance ledger. Every
  debit, credit, rebate, recovery, forfeiture, and absolute administrator
  correction locks the wallet owner, validates integer cents, writes the
  compatibility transaction, and records before/after balances through the
  single wallet posting API. No feature module writes balances directly.
- **EpayPaymentAttempt** is a signed external-payment intent. It snapshots the
  gateway credentials and entitlement terms used when the intent was created,
  so later settings or catalog edits cannot invalidate or alter settlement.
  Verified callbacks are idempotent. Fulfillment failures remain retryable and
  record their reason and attempt count for reconciliation. A verified payment
  that can no longer be fulfilled is marked `REFUND_PENDING`; its immutable
  credential snapshot is used for automatic refund. Missing credentials,
  rejected verification, and failed compensation become `MANUAL_REVIEW`
  instead of silently accepting revenue. Callback and active query results
  share one serializable settlement entry point. Active query
  responses are trusted only after signature, order number, integer-cent
  amount, channel, and status validation; query failures never create revenue
  or entitlements.
- **EpayGatewayTestAttempt** is an administrator-initiated ¥0.01 gateway probe.
  It snapshots the credentials and callback contract but never creates an
  order, payment record, revenue, subscription, entitlement, or traffic pack.
  Enabling 易支付 requires settled Alipay and WeChat Pay tests for the current
  gateway, merchant, and key, plus an enabled active-query reconciler. Changing
  payment credentials invalidates the corresponding test fingerprints.
- **Order center** is a read projection over `ManualOrder`, `PaymentRecord`,
  `Refund`, and `EpayPaymentAttempt`. It does not create another financial
  ledger. Pending or failed payment attempts remain separate from fulfilled
  orders and are visible in the payment-exception view.
- A complimentary admin grant records the offer list price and an equal
  discount, with zero charged revenue.
- A plan CDK references a concrete `CatalogOffer`. Its revenue snapshot is the
  offer price at redemption; `amountCents` is only meaningful for wallet codes.
- A plan CDK uses `RENEW` to extend the same current plan or `REPLACE` to start
  its bound offer immediately and reset the base plan entitlement.
- Existing product CDKs remain redeemable after the site switches to 易支付.
  New plan and traffic-pack CDKs are blocked while 易支付 is active.
- **Refund** reduces recognized payment revenue. Partial refunds recover
  inviter cashback proportionally and preserve granted bonus traffic. A full
  refund revokes the unused portion of the linked standard plan, traffic pack,
  Ultra grant, plan-reset credit, referral bonus, and group-buy bonus as
  applicable. Historical usage and usage allocations remain immutable.

## Member activities

- **DailyCheckIn** is one idempotent daily reward for a member with a currently
  active Standard or Ultra entitlement. Its quota credit is posted by
  `EntitlementService` and recorded as a quota adjustment.
- **GroupBuy** snapshots its offer, member count, duration, discount or balance
  rebate, and bonus traffic. Each member also owns an immutable entitlement
  snapshot because activation depends on that member's current plan. Payment
  immediately creates the member's normal order: no plan starts now, the same
  plan renews without resetting current usage, and a different plan defaults to
  the current plan's expiry unless immediate switching was explicitly selected.
  The first valid payment for a member fulfills; a later valid duplicate enters
  compensation refund. Successful groups post rebates through the wallet ledger
  and bonuses through `EntitlementService`; a scheduled-plan bonus starts with
  the purchased target plan and uses its access profile.
- Unrecovered group-buy rebate debt is stored in structured member fields and
  indexed for the administrator exception view; it is never hidden only in an
  audit JSON blob.

## Tutorials

- **TutorialGuide** is the stable platform entry.
- **TutorialRevision** is a draft, published, or archived version.
- **TutorialStep** is ordered text with an optional image.
- **TutorialImage** is a validated JPEG/PNG/WebP upload stored as responsive
  WebP assets.

Publishing is atomic: archive the previous published revision, publish the
draft, and switch the guide pointer in one database transaction.

## SEO publishing

- **SeoArticle** is the stable content identity and public slug owner. It keeps
  independent draft and published revision pointers so work in progress never
  changes the public page.
- **SeoArticleRevision** is immutable editorial content. Tiptap JSON is the
  source of truth; its server-rendered HTML snapshot contains only supported,
  escaped nodes and safe links. AI revisions retain exact public-source
  evidence, its applicable version, an independent editorial audit, and the
  last verification time. Review belongs to the revision that was approved,
  not to a later edit.
- **SeoKeyword** assigns one primary search intent to at most one article.
  Similar content above the quality threshold is rejected in favor of updating
  the existing article.
- **SeoGenerationJob** is an administrator-visible AI work item. It records the
  models, prompt version, token use, image outcome, duration, attempts, and a
  sanitized failure reason. The evidence, draft, per-article metadata, and
  independent-audit stages are recorded separately. Configured scheduling is
  idempotent per Asia/Shanghai date and creates drafts only; the default is two
  high-quality drafts per week rather than volume-oriented publishing.
- **SeoIndexSubmission** is the durable delivery queue for IndexNow and Google
  sitemap notifications. A published revision and operation form its
  idempotency identity; automatic retries use exponential backoff and stop
  after six attempts.
- **SeoRedirect** preserves an old published slug after an approved rename.
  **SeoSearchMetric** stores deduplicated Search Console page/query/day rows.
- Generated and uploaded images are normalized to 1600x900 WebP in persistent
  `storage/seo-images`. Full-site backup and restore treat that directory and
  the database as one release-versioned unit.

AI adapters may read public site information, public tutorial configuration,
and published article titles. They must never read support tickets, member
email addresses, orders, usage, or other private data. Search integrations are
disabled by default; Google ordinary articles use sitemap/Search Console, not
the Indexing API. There is no preferred article word count: completeness,
evidence, actionability, intent fit, and original value form the publication
gate, while length is only a diagnostic signal.

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
- A pending attribution qualifies only when the invitee's first plan CDK or
  verified Epay purchase successfully grants an eligible plan entitlement.
  Wallet checkout, traffic-pack and balance CDKs, and complimentary admin
  grants do not qualify. Wallet checkout intentionally does not earn cashback,
  avoiding rebate and refund loops where credited balance creates more credit.
- New attributions snapshot the configured inviter cashback basis points. At
  settlement, the inviter receives that percentage of the qualifying paid plan
  order amount, rounded down to integer cents, and the actual amount is stored
  on the attribution. Legacy pending attributions with no percentage snapshot
  keep their promised fixed reward. The invitee traffic amount is also a
  snapshot and is issued as a system-managed traffic-pack entitlement with the
  qualifying plan's access profile and expiry.
- A partial refund recovers inviter cashback in proportion to the cumulative
  refunded amount. A full refund completes cashback recovery and cancels the
  invitee bonus grant. Wallet recovery stops at zero and records unrecovered
  debt; consumed traffic and immutable usage allocations are never rewritten.

## Module seams

- `CatalogService`: catalog products, offers, access profiles, portal catalog.
- `EntitlementService`: grants, quota buckets, access resolution, usage batches.
- `wallet/wallet-ledger`: the only balance mutation and immutable ledger API.
- `CustomerAdminService`: customer search and lazy detail views.
- `NodeOpsService` and `OperationsService`: server topology and live operations.
- `FinanceService`: paged ledgers and database-aggregated reporting.
- `TutorialsService`: drafts, assets, publication, and published guides.
- `SeoPublishingService`: keyword ownership, immutable article revisions,
  quality checks, publication, indexing jobs, and Search Console projections.
- `ReferralService`: stable codes, read models, transactional settlement, and
  conservative refund reversal.
- `CheckInService` and `GroupBuyService`: activity state machines. They request
  quota and wallet mutations from their owning domain APIs rather than writing
  buckets, grants, or balances directly.
- `MemberOnboardingService`: atomic member, access identity, and optional email
  referral attribution creation.
- `ControlPlaneStoreService`: legacy compatibility adapter only. Do not add new
  business behavior to this module.

Tests cross these interfaces. Database, Redis, node agents, SMTP, and image
storage are adapters at external seams; private helpers are not test surfaces.
