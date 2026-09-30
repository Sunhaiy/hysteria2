# Clash / Mihomo subscription groups

One Clash subscription exposes four groups, in this order:

| Group | Default and purpose |
| --- | --- |
| 节点选择 | Defaults to 自动优选; residential nodes require manual selection. |
| 自动优选 | Ordered fallback: ordinary premium nodes first, intermediate/backup nodes last. Excludes residential nodes, even when all ordinary nodes fail. |
| 住宅线路 | Only authorized residential nodes; unavailable access rejects instead of falling back to ordinary nodes or DIRECT. |
| AI 服务 | Follows 节点选择 by default; permits a manual residential override. |

Media and Telegram rules follow 节点选择. Private-network and domestic direct routing remain unchanged. No DNS or TUN settings are emitted: all groups, including residential, retain the client's original DNS configuration. There is no separate residential subscription and no DNS leak-protection claim.

Inline profiles contain authorized concrete nodes. Dynamic profiles use account-isolated all, automatic, and residential providers refreshed every 900 seconds. The legacy ai scope remains accepted for previously downloaded profiles. Providers filter only already-authorized nodes. Empty providers emit reject placeholders to clear cached nodes.

Residential classification recognizes 住宅/家宽 labels or residential/home tags. Backup classification recognizes 中级/备用 labels. Existing protocol suffixes are not duplicated; icons are preserved.

After release, update the full subscription once to receive the four-group structure. Provider refresh alone does not change groups. Saved manual choices may need reselection after group/node names change.
