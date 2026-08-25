#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_ISOLATED_RUNTIME_TEST:-}" != "isolated-node" ]]; then
  echo "Set CONFIRM_ISOLATED_RUNTIME_TEST=isolated-node for a dedicated inactive test node" >&2
  exit 2
fi
: "${AGENT_URL:?AGENT_URL is required}"
: "${AGENT_SECRET:?AGENT_SECRET is required}"
: "${SERVICE:?SERVICE is required}"
if [[ "$SERVICE" != "xray" && "$SERVICE" != "hysteria2" ]]; then
  echo "SERVICE must be xray or hysteria2" >&2
  exit 2
fi

temporary_dir="$(mktemp -d)"
restore_needed=false
cleanup() {
  if [[ "$restore_needed" == true ]]; then
    request_id="smoke-restore-$(date +%s)-$RANDOM"
    printf 'header = "Authorization: %s"\n' "$AGENT_SECRET" |
      curl --config - --silent --show-error --max-time 12 \
        -H 'Content-Type: application/json' \
        --data "{\"service\":\"$SERVICE\",\"action\":\"stop\",\"idempotencyKey\":\"$request_id\"}" \
        "${AGENT_URL%/}/service/control" >/dev/null || true
  fi
  rm -r -- "$temporary_dir"
}
trap cleanup EXIT

agent_get_status() {
  local output_file="$1"
  printf 'header = "Authorization: %s"\n' "$AGENT_SECRET" |
    curl --config - --silent --show-error --fail --max-time 10 \
      --output "$output_file" "${AGENT_URL%/}/service/status?service=$SERVICE"
  node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(value.status);
  ' "$output_file"
}

agent_control() {
  local action="$1"
  local request_id="smoke-${action}-$(date +%s)-$RANDOM"
  printf 'header = "Authorization: %s"\n' "$AGENT_SECRET" |
    curl --config - --silent --show-error --fail --max-time 12 \
      -H 'Content-Type: application/json' \
      --data "{\"service\":\"$SERVICE\",\"action\":\"$action\",\"idempotencyKey\":\"$request_id\"}" \
      "${AGENT_URL%/}/service/control" >/dev/null
}

before="$(agent_get_status "$temporary_dir/before.json")"
if [[ "$before" != "inactive" ]]; then
  echo "Refusing runtime smoke test: initial state is $before, not inactive" >&2
  exit 2
fi

agent_control start
restore_needed=true
[[ "$(agent_get_status "$temporary_dir/started.json")" == "active" ]]
agent_control stop
restore_needed=false
[[ "$(agent_get_status "$temporary_dir/stopped.json")" == "inactive" ]]
echo "Runtime control smoke test passed and restored the inactive state"
