# Mihomo routing

## Subscription branding and node icons

New portal import/copy/QR links use `?profile=2` on both subscription formats.
Only these links receive the default title `素心 Network` and an RFC 5987 UTF-8
download filename. Unversioned URLs retain their existing filename and title
headers, so refreshing an already imported subscription does not opt into the
new naming policy. The client still owns locally edited subscription names.
Both formats advertise `Profile-Web-Page-Url` pointing to the configured web
origin's `/login`; the actual website action depends on client support.

Administrators can edit the optional `icon` field on a node via the existing
node create/update endpoints. It accepts up to 32 characters, excluding control
characters; an empty value clears it and an omitted update preserves it.
Use Emoji or symbols (for example `🇺🇸` or `⚡`), not image URLs. The icon is
prepended only when rendering subscription names and the admin node list.
The underlying node label, machine tier and billing rate remain independent.
Mihomo selector references are generated from the same decorated names.
The nullable `20260915120000_node_icon` migration leaves existing nodes unchanged.

The `/subscribe/{token}/clash` profile consumes native MRS rule sets from
[MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat), `meta`
branch. Upstream rule data is GPL-3.0; it is fetched by the client and is not
vendored into this repository.

Order: private networks, explicit AI compatibility rules, upstream AI category,
YouTube/Netflix/Spotify, Telegram, overseas domains, Chinese domains/IPs, then
the default node selector. Media and Telegram have independent selectors.
Only the member's authorized endpoints are included. Existing failover and
latency selection remain available; this is not an unlock or throughput test.

Private IPv4/IPv6 CIDR rules intentionally omit `no-resolve`: a domain resolving
to an intranet address must match DIRECT before any overseas/fallback rule.
Literal private IPs also remain direct. Public-IP rules retain their existing
policy. The subscription does not override client DNS: company-only domains
still require the client's system/company DNS or a client-specific split-DNS
policy. Removing `no-resolve` cannot make a public DNS server resolve private
company names. Users must refresh the Clash subscription after deployment and
use rule mode; global mode and client rule overrides can bypass this policy.

The optional real-core regression runs entirely on ephemeral loopback ports,
with a fixture DNS server and HTTP intranet; no production node is contacted:
set `MIHOMO_TEST_BINARY` to an existing Mihomo executable, then run
`pnpm --filter @hysteria/api exec jest --config test/jest-e2e.json mihomo-private-routing --runInBand`.
It covers a domain resolving to a private IP, literal-IP access, and a public-IP
domain that must not bypass proxy policy. Without that environment variable,
the integration suite is skipped; profile unit tests still run normally.

Providers refresh every 86400 seconds and use distinct persistent cache files.
Downloads use the node selector, avoiding dependence on rule matching to reach
GitHub. Cached data remains available if a subsequent update fails. A first
import still requires a working download path: there is no bundled offline
copy or guaranteed initial-download fallback. Explicit private CIDRs and AI
domains remain in the profile; unmatched destinations default to the proxy
selector. Use a current Mihomo client with MRS support.

The plain URI subscription remains protocol endpoints only: clients importing
that format continue to manage their own routing rules. After deployment,
existing Mihomo users must refresh their subscription once to get providers.
