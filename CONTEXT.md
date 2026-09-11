# Project context

## Current product language

- A `CatalogProduct` is a member-facing plan or traffic-pack product.
- A `CatalogOffer` is one purchasable month, quarter, or year. The offer owns
  its price, quota, and store URL. `CatalogProduct.storeUrl` is a compatibility
  fallback only.
- A plan CDK references one `CatalogOffer` and has a `planMode`: `RENEW`
  extends the same active plan, while `REPLACE` starts the selected offer now
  and discards the old plan's remaining base duration and quota.
- A `SupportTicket` is a member-owned support conversation. Member activity
  sets `WAITING_STAFF`, staff replies set `WAITING_MEMBER`, and closed tickets
  are immutable until an administrator reopens them.
- A `TutorialGuide` is a stable platform entry. Installation packages belong
  to the platform guide, while step images belong to tutorial steps.
- A `ReferralCode` is one member's stable invitation identity. It can be
  generated once while the activity is open and cannot be reset by the member.
- A `ReferralAttribution` is the lifetime inviter relationship captured during
  email registration. It is pending until the invitee's first qualifying paid
  plan purchase through a plan CDK or Epay grants a plan, then it is rewarded
  or conservatively reversed after a refund.
- A `WalletLedgerEntry` is the immutable source of truth for balance movement.
  Feature modules call the wallet posting API and never update a balance or
  create compatibility wallet rows themselves.
- `EntitlementService` owns every grant, quota bucket, quota adjustment,
  revocation, and access-snapshot mutation. Check-in, group-buy, referrals,
  commerce, catalog, and customer administration call this boundary.
- Paid fulfillment has an explicit state separate from gateway payment state.
  Retryable failures stay in reconciliation; non-retryable failures enter
  compensation refund, and missing credential snapshots require manual review.
- A `SeoArticle` owns separate draft and published revision pointers. Editing,
  AI retry, cover regeneration, and version restore always create a new draft
  revision; public readers only receive the reviewed published revision.
- A `SeoGenerationJob` creates a draft from an administrator-owned keyword.
  Scheduled runs are idempotent per Asia/Shanghai calendar date and never
  publish automatically. `SeoIndexSubmission` is the six-attempt delivery
  queue for IndexNow and Google sitemap notifications.
- A new checkout abandons only the same member's unpaid active Epay attempts.
  Idempotency replays remain stable, while a late payment for an explicitly
  abandoned attempt is accepted into compensation refund and never fulfilled.
- Wallet plan checkout does not earn referral cashback. Partial refunds recover
  cashback proportionally; full refunds also revoke unused linked entitlement
  and bonus traffic without rewriting usage history.

## Compatibility rules

- `/subscribe/{token}` remains the v2rayN/Hiddify subscription.
- `/subscribe/{token}/clash` is the Clash/Mihomo subscription with automatic
  node selection. Both are generated from current serviceable nodes on every
  refresh.
- Legacy plan, offer, product store URL, and tutorial setting fields remain
  readable during the expand-contract migration window.
- Local development changes must not connect to or mutate production nodes.
- Full-site restore accepts only a backup whose manifest and restored
  `_prisma_migrations` version exactly match the running release.
- Node access lifecycle and runtime service state are separate. Runtime start,
  stop, and status requests are durable worker-owned commands; API requests do
  not call systemd or node agents directly.
- Monthly infrastructure traffic protection belongs to `NodeServer` and sums
  all of its protocol endpoints. Reaching the limit disables access before the
  worker queues endpoint stop commands.
- Search engines may crawl only the homepage, `/blog`, and reviewed published
  articles. AI context is limited to public site information, tutorials, and
  published article titles; member data and support tickets are not inputs.

See `docs/DOMAIN_MODEL.md` and `docs/adr/` for implementation details.
