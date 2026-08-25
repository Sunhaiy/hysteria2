#!/usr/bin/env bash
set -euo pipefail

release_dir="${RELEASE_DIR:-$(pwd)}"
api_url="${API_URL:-http://127.0.0.1:4000/api/health/ready}"
web_url="${WEB_URL:-http://127.0.0.1:3001/login}"
agent_checks_file="${AGENT_CHECKS_FILE:-}"
baseline_file="${BASELINE_FILE:-/tmp/hysteria2-control-plane-baseline.txt}"
compare_file="${COMPARE_BASELINE_FILE:-}"
node_bin="${NODE_BIN:-node}"
control_plane_units="${CONTROL_PLANE_UNITS:-hysteria2-api.service hysteria2-web.service hysteria2-sync-worker.service}"
runtime_units="${NODE_RUNTIME_UNITS:-}"

if [[ -z "$agent_checks_file" || ! -s "$agent_checks_file" ]]; then
  echo "AGENT_CHECKS_FILE must name a non-empty runtime-agent inventory" >&2
  exit 2
fi
if [[ -z "${SUBSCRIPTION_PROBE_URL:-}" ]]; then
  echo "SUBSCRIPTION_PROBE_URL is required" >&2
  exit 2
fi

for command_name in curl pnpm systemctl sha256sum "$node_bin"; do
  command -v "$command_name" >/dev/null || {
    echo "Missing required command: $command_name" >&2
    exit 2
  }
done

cd "$release_dir"
test -f apps/api/prisma/migrations/20260825120000_node_runtime_control/migration.sql
test -f apps/api/dist/main.js
test -f apps/web/.next/BUILD_ID
pnpm --filter @hysteria/api exec prisma migrate status
"$node_bin" apps/api/prisma/verify-runtime-agent-inventory.js "$agent_checks_file"
curl --silent --show-error --fail --max-time 10 "$api_url" >/dev/null
curl --silent --show-error --fail --max-time 10 "$web_url" >/dev/null

temporary_dir="$(mktemp -d)"
cleanup() {
  rm -r -- "$temporary_dir"
}
trap cleanup EXIT
current="$temporary_dir/current.txt"
umask 077
{
  echo "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "release=$(readlink -f "$release_dir")"
} >"$current"

for unit in $control_plane_units; do
  systemctl is-active --quiet "$unit"
  key="${unit//[^A-Za-z0-9]/_}"
  echo "control_unit_${key}_pid=$(systemctl show -p MainPID --value "$unit")" >>"$current"
done

for unit in $runtime_units; do
  key="${unit//[^A-Za-z0-9]/_}"
  echo "runtime_unit_${key}_pid=$(systemctl show -p MainPID --value "$unit")" >>"$current"
done

agent_get() {
  local base_url="$1"
  local secret="$2"
  local path="$3"
  local output_file="$4"
  printf 'header = "Authorization: %s"\n' "$secret" |
    curl --config - --silent --show-error --fail --max-time 10 \
      --output "$output_file" "${base_url%/}${path}"
}

index=0
while IFS='|' read -r label base_url secret service expected_status; do
  [[ -z "$label" || "${label:0:1}" == "#" ]] && continue
  if [[ ! "$label" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Invalid agent inventory label: $label" >&2
    exit 2
  fi
  if [[ "$service" != "xray" && "$service" != "hysteria2" ]]; then
    echo "Invalid logical service for $label" >&2
    exit 2
  fi
  expected_status="${expected_status:-active}"
  if [[ "$expected_status" != "active" && "$expected_status" != "inactive" ]]; then
    echo "Invalid expected status for $label: $expected_status" >&2
    exit 2
  fi
  status_file="$temporary_dir/agent-${index}-status.json"
  agent_get "$base_url" "$secret" "/service/status?service=$service" "$status_file"
  status="$($node_bin -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (value.service !== process.argv[2] || typeof value.status !== "string") process.exit(3);
    if (!Number.isInteger(value.mainPid) || value.mainPid < 0) process.exit(3);
    process.stdout.write(`${value.status}|${value.mainPid}`);
  ' "$status_file" "$service")"
  main_pid="${status#*|}"
  status="${status%%|*}"
  if [[ "$status" != "$expected_status" ]]; then
    echo "Agent $label is $status; expected $expected_status" >&2
    exit 1
  fi
  if [[ "$status" == "active" && "$main_pid" -le 0 ]]; then
    echo "Agent $label reported active without a main PID" >&2
    exit 1
  fi
  echo "agent_${label}_service=$service" >>"$current"
  echo "agent_${label}_status=$status" >>"$current"
  echo "agent_${label}_pid=$main_pid" >>"$current"

  if [[ "$service" == "xray" ]]; then
    online_file="$temporary_dir/agent-${index}-online.json"
    users_file="$temporary_dir/agent-${index}-users.json"
    agent_get "$base_url" "$secret" "/online" "$online_file"
    agent_get "$base_url" "$secret" "/users/count" "$users_file"
    online="$($node_bin -e '
      const fs = require("fs");
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(Object.values(value).reduce((sum, item) => sum + Number(item || 0), 0)));
    ' "$online_file")"
    users="$($node_bin -e '
      const fs = require("fs");
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (!Number.isInteger(value.total) || value.total < 0) process.exit(3);
      process.stdout.write(String(value.total));
    ' "$users_file")"
    echo "agent_${label}_online=$online" >>"$current"
    echo "agent_${label}_users=$users" >>"$current"
  fi
  index=$((index + 1))
done <"$agent_checks_file"
echo "agent_count=$index" >>"$current"

subscription_file="$temporary_dir/subscription"
printf 'url = "%s"\n' "$SUBSCRIPTION_PROBE_URL" |
  curl --config - --silent --show-error --fail --max-time 10 \
    --output "$subscription_file"
test -s "$subscription_file"
echo "subscription_sha256=$(sha256sum "$subscription_file" | awk '{print $1}')" >>"$current"

baseline_value() {
  local key="$1"
  awk -F= -v expected="$key" '$1 == expected { sub(/^[^=]*=/, ""); print; exit }' "$compare_file"
}

if [[ -n "$compare_file" ]]; then
  test -s "$compare_file"
  while IFS='=' read -r key value; do
    case "$key" in
      agent_count|agent_*_pid|agent_*_status|runtime_unit_*_pid|subscription_sha256)
        expected="$(baseline_value "$key")"
        [[ -n "$expected" && "$value" == "$expected" ]] || {
          echo "Cutover comparison failed for $key" >&2
          exit 1
        }
        ;;
      agent_*_users)
        expected="$(baseline_value "$key")"
        [[ -n "$expected" && "$value" -ge "$expected" ]] || {
          echo "Authorized user count decreased for $key" >&2
          exit 1
        }
        ;;
    esac
  done <"$current"
fi

install -m 0600 "$current" "$baseline_file"
echo "Preflight passed. Baseline: $baseline_file"
