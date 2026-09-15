#!/usr/bin/env bash
set -euo pipefail
# Build a pinned upstream release plus the small, reviewed per-user close patch.
# Usage: bash ops/xray/build-session-core.sh /absolute/output/directory
assets=$(cd -- "$(dirname -- "$0")" && pwd)
output=${1:?Specify an output directory}
mkdir -p -- "$output"
output=$(cd -- "$output" && pwd)
checkout=$(mktemp -d)
echo "Build checkout: $checkout"
git -C "$checkout" init -q
git -C "$checkout" fetch --depth 1 https://github.com/XTLS/Xray-core.git d2758a023cd7f4174a5a5fa4ff66e487d4342ba0
git -C "$checkout" checkout -q FETCH_HEAD
git -C "$checkout" apply --check "$assets/session-revocation.patch"
git -C "$checkout" apply "$assets/session-revocation.patch"
cp "$assets/user_sessions.go" "$assets/user_sessions_test.go" "$checkout/proxy/vless/inbound/"
cd -- "$checkout"
go test ./proxy/vless/inbound -run TestRemoveUser -count=1
GOOS=${TARGET_GOOS:-linux} GOARCH=${TARGET_GOARCH:-amd64} CGO_ENABLED=0 go build -trimpath \
  -ldflags '-s -w -X github.com/xtls/xray-core/core.codename=suxin-session-revoke-v1' \
  -o "$output/xray" ./main
sha256sum "$output/xray"
echo 'Build complete. This script does not install or restart any service.'

