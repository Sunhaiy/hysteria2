# Residential access and catalog labels

Residential endpoints are reserved for Plus, Prime, Max, Elite and Spark.
Go, Start, Pro, Boost, standalone traffic packs and the separate permanent Ultra
series do not independently grant access to these endpoints. The operational
source of truth remains `AccessProfileNode`, including historical profile IDs
held by existing entitlements. Do not copy all ordinary-node bindings when adding
a residential endpoint. Preserve the residential machine's configured billing
multiplier when changing access.

The catalog returns `access.lineTags` from the plan's actual assigned residential
nodes (tag `residential`/`home`, or the legacy residential label). Plan cards render
the configured line descriptors 家宽、住宅、专线 separately from marketing badges.
These labels do not change billing or authorize access. Retired nodes are excluded
by the catalog query; temporary node downtime does not erase the product's access
description.

Clash expiration notice configuration belongs to `/admin/settings`, using the
existing `/api/admin/settings/subscription-notices` API and existing stored names.
It has no dependency on the holiday campaign or its enabled state.

## 2026-10-06 production access adjustment

- Restricted both residential endpoints on 216.36.112.103 to seven current and
  historical access profiles for the five eligible plans. Multiplier stays 2.6x.
- Backed up the previous node/profile bindings and eligible user sets privately at
  `/root/residential-access-before-20261006.json` on the main server; audit action
  `node.residential.plus_access_only` records the change.
- Verified no active unconverted legacy direct subscription or profileless pack
  bypasses the new access assignments.
- Eligible users changed from 249 to 49; VLESS provisioning synchronized, and
  revocation work queued separately for the two residential endpoints.
- Verified eligible and ineligible accounts against both ordinary and Clash
  subscriptions. Ordinary node access remains present for both accounts.
- Real clients: both protocols connect for the eligible account and return the
  residential IP; VLESS rejects the ineligible account, and Hysteria rejects it
  during authentication. No unauthorized successful Hysteria authentication in
  the checked three-minute window, and no unauthorized active streams.
- Hysteria's idle online records can remain after `/kick`: upstream records the
  kick and handles it on subsequent traffic. An empty online list is not an
  appropriate immediate assertion. Ongoing worker revocation and current
  per-node authentication remain in force; no service restart was used.

UI validation used local mocked API data, desktop/mobile and light/dark mode.
Production access configuration was applied before the UI release. The UI release
uses catalog cache version v4 so old cached products cannot hide the new labels.
Release through candidate API/Web services without restarting the node cores or
sync worker; no database migration is required.
