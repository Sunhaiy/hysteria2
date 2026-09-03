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

## Compatibility rules

- `/subscribe/{token}` remains the v2rayN/Hiddify subscription.
- `/subscribe/{token}/clash` is the Clash/Mihomo subscription with automatic
  node selection. Both are generated from current serviceable nodes on every
  refresh.
- Legacy plan, offer, product store URL, and tutorial setting fields remain
  readable during the expand-contract migration window.
- Local development changes must not connect to or mutate production nodes.
- Node access lifecycle and runtime service state are separate. Runtime start,
  stop, and status requests are durable worker-owned commands; API requests do
  not call systemd or node agents directly.
- Monthly infrastructure traffic protection belongs to `NodeServer` and sums
  all of its protocol endpoints. Reaching the limit disables access before the
  worker queues endpoint stop commands.

See `docs/DOMAIN_MODEL.md` and `docs/adr/` for implementation details.
