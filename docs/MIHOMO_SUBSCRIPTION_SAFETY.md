# Mihomo subscription safety

The default `节点选择` and `普通线路` remain manual selectors. Existing node
display names, direct node choices, ordering within ordinary/residential groups
and `store-selected` are preserved. Refreshing a profile does not deliberately
move an existing user onto an automatic route.

Two optional groups use only authorized ordinary nodes:

- `自动优选`: URL test, HTTPS gstatic 204, 300 seconds, 50 ms tolerance.
- `故障转移`: fallback in ordinary-node order (backup nodes last), 300 seconds.

Both use `lazy: true`; the client may perform an initial health check. These
checks measure reachability/latency, not bandwidth or AI service availability.
Residential nodes remain manual and do not join either automatic group. AI
continues following `节点选择` unless the user explicitly selects residential;
choosing automation in the main group also affects services following it.

`住宅线路` and its references are emitted only if the authorized, serviceable
input contains a residential node. No entitlement checks are bypassed. The
same rule applies to an empty ordinary group: residential-only access defaults
to residential, and completely empty access remains REJECT. Existing deployed
profiles change only when the client refreshes the full subscription.

Provider mode reuses disjoint ordinary/residential providers across groups;
it does not duplicate the same named node in an additional all-node provider.
The `scope=all` and `scope=ai` endpoints remain compatible with older profiles.
A scope absent on full import becomes visible only after another full profile
refresh; provider-only refresh cannot add a new strategy group. If access to an
existing scope disappears later, its provider returns a reject placeholder to
clear stale access. Server authentication remains authoritative.

HY2 certificate pins use Mihomo's `fingerprint` field, not `ca-sha256`, which
the HY2 adapter ignores. A pin is independent of `skip-cert-verify`: the latter
controls ordinary CA verification; a configured pin is still checked. Deploy
only after comparing the current pins against actual node certificates. Nodes
without pins retain their existing CA-verification settings. VLESS REALITY
configuration is unchanged.

Client DNS/TUN settings remain untouched. `store-fake-ip` only saves the DNS
mapping when the client enables fake-IP. Existing daily MRS downloads and
persistent cache paths are preserved. This change does not provide a domestic
rule mirror or offline initial rule set; a first import still needs a working
route to upstream. Replacing that path requires a separately maintained and
verified mirror, not an arbitrary third-party URL.

Validation:

```sh
pnpm --filter @hysteria/api exec jest mihomo --runInBand
MIHOMO_TEST_BINARY=/path/to/mihomo HYSTERIA_TEST_BINARY=/path/to/hysteria \
  pnpm --filter @hysteria/api exec jest --config test/jest-e2e.json 'mihomo-(safety|provider-refresh|private-routing)' --runInBand
```

The real-core tests use ephemeral loopback listeners, generated two-day test
certificates and fixture credentials. They verify wrong-pin rejection, a
legacy ignored-pin control, successful correct-pin connections, both automatic
groups, manual selection across reload, provider refresh/cache/revocation and
private-network routing. Set `OPENSSL_TEST_BINARY` if OpenSSL is not on PATH.
Without both test binaries the new HY2 suite is explicitly skipped.

Sources: [Mihomo HY2 adapter](https://github.com/MetaCubeX/mihomo/blob/v1.19.33/adapter/outbound/hysteria2.go),
[certificate verifier](https://github.com/MetaCubeX/mihomo/blob/v1.19.33/component/ca/config.go),
[URL test](https://wiki.metacubex.one/config/proxy-groups/url-test/).
