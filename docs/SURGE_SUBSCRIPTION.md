# Surge subscription

`/subscribe/{token}/surge?profile=2` serves a complete plaintext Surge managed
profile. The member access page exposes this separately from URI/Base64 and
Clash YAML subscriptions. Paste this URL into Surge's profile download action.

The endpoint reuses `getSubscriptionAccessBundle`, including token revocation,
active entitlements, available quota and per-plan node access. It uses the same
HY2 authentication token; billing and server enforcement are unchanged. It
requires no migration or node restart. Responses forbid shared caching.

Only Hysteria2 nodes without Salamander obfuscation are exported. This common
subset supports both iOS 5.8.0+ and Mac 5.4.0+; VLESS Reality is not converted.
Surge's documented Salamander support is Mac-only, so obfuscated nodes are
excluded from this cross-platform profile. No compatible nodes yields an
explicit 404, and the portal hides the copy action with an explanation.

Connection address, authentication, SNI, certificate pin and port hopping are
preserved. Names retain icons and labels, with INI separators sanitized and
duplicates disambiguated. Invalid connection data fails closed without logging
credentials. A configured certificate pin takes precedence over insecure TLS.

The four manual groups are 节点选择, 普通线路, 住宅线路 and AI 服务. Ordinary
nodes precede backups and exclude residential nodes. Missing groups select
REJECT, never silently route overseas traffic directly. No automatic bulk
latency tests or DNS overrides are added. Routing includes private networks,
explicit AI domains, GEOIP CN direct and a proxy FINAL rule. This is a native
Surge rule profile, not a conversion of Mihomo MRS files.

Managed updates use the configured public API origin, a 43200-second minimum
interval and strict=false so a failed download does not prevent use of a
previous configuration. Surge updates only while its main application is open;
this is not an exact background timer. Access remains enforced on the server.
Clash and ordinary subscription behavior is unchanged.

Official references:
- https://manual.nssurge.com/policies/hysteria2.html
- https://manual.nssurge.com/policies/tls.html
- https://manual.nssurge.com/profile/managed-profile.html
- https://manual.nssurge.com/profile/format.html

Validation: profile unit tests plus `surge-subscription.e2e-spec.ts` exercise the
real controller and service with isolated entitlement/database fixtures. No
production member credentials or nodes are used. Native Surge import/connect
requires an Apple device and is a separate acceptance check.
