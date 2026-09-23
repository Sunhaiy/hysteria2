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
  revision; public readers only receive the quality-checked published revision.
  Editorial formatting, keyword placement, images and subjective numeric scores
  are recommendations, not publication gates. AI factual/intent failures still
  stop automatic publishing. An authenticated SEO editor can explicitly confirm
  a specific draft for manual publication; current content checks still reject
  empty/thin, highly repetitive/duplicate content and absolute service promises.
  Manual review preserves the prior report, reviewer and time in the revision,
  and compares the draft pointer again in the publication transaction.
- New `SeoGenerationJob` snapshots opt into quality-gated automatic publishing from a keyword or explicit
  administrator-provided material/public reference URLs. Material jobs analyze
  their topic before assigning a keyword and use actor-scoped idempotency keys.
  Validated stage checkpoints survive retries. A completed draft is never
  overwritten by crash recovery; one evidence-enriched automatic revision is allowed before
  retaining a blocked draft. Explicit retries can create a new AI revision only
  when the original AI draft is still current, unpublished and unedited.
  Initial source gaps inform revision; the independent audit decides whether
  the final article still relies on unsupported facts. Unrelated internal asset
  checks do not block a useful general guide. Material retries may select a
  reader-focused topic; keyword reassignment and the new revision commit together,
  with topic uniqueness and protection against concurrent manual edits preserved.
  Automatic text generation never calls an image model; covers are optional uploads.
  Research reuses the configured
  upstream and is supported only after actual search tool output and safe source
  retrieval; model prose alone is not a capability signal.
  Scheduled runs are idempotent per Asia/Shanghai calendar date and
  automatically publish only passing revisions. Historical job snapshots without
  autoPublish remain manual; generated revision IDs guard publishing and recovery.
  `SeoIndexSubmission` is the six-attempt delivery
  queue for IndexNow and Google sitemap notifications.
- A new checkout abandons only the same member's unpaid active Epay attempts.
  Idempotency replays remain stable, while a late payment for an explicitly
  abandoned attempt is accepted into compensation refund and never fulfilled.
- Wallet plan checkout does not earn referral cashback. Partial refunds recover
  cashback proportionally; full refunds also revoke unused linked entitlement
  and bonus traffic without rewriting usage history.

## Compatibility rules

- Traffic billing uses max(NodeServer rate, member override), independently of
  old product/grant snapshots. Top-tier machines default to 2x, others to 1x;
  all protocols on one machine share the rate. Historical rollups are immutable.

- `/subscribe/{token}` remains the v2rayN/Hiddify subscription.
- `/subscribe/{token}/clash` is the Clash/Mihomo subscription with automatic
  node selection. Both are generated from current serviceable nodes on every
  refresh.
- Mihomo routing uses MetaCubeX/meta-rules-dat MRS providers with daily client
  refresh and persistent caching, plus separate AI, media, and Telegram groups.
  Plain URI subscriptions do not carry routing rules.
- Legacy plan, offer, product store URL, and tutorial setting fields remain
  readable during the expand-contract migration window.
- Local development changes must not connect to or mutate production nodes.
- `AgentUpdatesModule` owns signed Agent releases and sequential pull rollouts.
  Independent node updaters restart only the pinned Agent service, preserve
  traffic state, and roll back locally even while offline. See ADR 0016.
- Full-site restore accepts only a backup whose manifest and restored
  `_prisma_migrations` version exactly match the running release.
- Node access lifecycle and runtime service state are separate. Runtime start,
  stop, and status requests are durable worker-owned commands; API requests do
  not call systemd or node agents directly.
- Monthly infrastructure traffic protection belongs to `NodeServer` and sums
  all of its protocol endpoints. Reaching the limit disables access before the
  worker queues endpoint stop commands.
- User quota disconnection is durable `NodeAccessRevocation` work owned by the
  worker. It checks current per-node access on every attempt, retries failed
  disconnects, and never derives targets solely from old `PlanBinding` rows.
  VLESS must confirm `suxin-session-revoke-v1` live-session revocation capability;
  removing authentication alone is insufficient. See ADR 0015.
- Search engines may crawl only the homepage, `/blog`, and reviewed published
  articles. AI context is limited to public site information, tutorials, and
  published article titles; member data and support tickets are not inputs.

See `docs/DOMAIN_MODEL.md` and `docs/adr/` for implementation details.

Clash feeds use isolated HTTP node providers with a 900-second refresh. Existing
imports need one complete profile refresh; `mode=inline` retains the legacy
format. Provider refresh does not replace server-side access enforcement. See
`docs/MIHOMO_PROVIDER_REFRESH.md`.
