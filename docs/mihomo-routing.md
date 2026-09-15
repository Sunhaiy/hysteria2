# Mihomo routing

The `/subscribe/{token}/clash` profile consumes native MRS rule sets from
[MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat), `meta`
branch. Upstream rule data is GPL-3.0; it is fetched by the client and is not
vendored into this repository.

Order: private networks, explicit AI compatibility rules, upstream AI category,
YouTube/Netflix/Spotify, Telegram, overseas domains, Chinese domains/IPs, then
the default node selector. Media and Telegram have independent selectors.
Only the member's authorized endpoints are included. Existing failover and
latency selection remain available; this is not an unlock or throughput test.

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
