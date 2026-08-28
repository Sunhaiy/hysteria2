#!/usr/bin/env bash
set -euo pipefail

environment_file="${HYSTERIA_PORT_HOPPING_ENV_FILE:-/etc/hysteria-port-hopping.env}"
if [[ -r "$environment_file" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$environment_file"
  set +a
fi

iptables_bin="${IPTABLES_BIN:-/usr/sbin/iptables}"
start="${HYSTERIA_PORT_HOPPING_START:-}"
end="${HYSTERIA_PORT_HOPPING_END:-}"
target="${HYSTERIA_PORT_HOPPING_TARGET:-}"

for value in "$start" "$end" "$target"; do
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "Port hopping requires numeric start, end, and target ports" >&2
    exit 2
  fi
done

start_value=$((10#$start))
end_value=$((10#$end))
target_value=$((10#$target))

if (( start_value < 1 || end_value > 65535 || start_value >= end_value )); then
  echo "Invalid port hopping range" >&2
  exit 2
fi
if (( end_value - start_value > 20000 )); then
  echo "Port hopping range cannot exceed 20001 UDP ports" >&2
  exit 2
fi
if (( target_value < 1 || target_value > 65535 )); then
  echo "Invalid Hysteria2 target port" >&2
  exit 2
fi
if (( target_value >= start_value && target_value <= end_value )); then
  echo "Hysteria2 target port must be outside the hopping range" >&2
  exit 2
fi
if [[ ! -x "$iptables_bin" ]]; then
  echo "iptables executable not found: $iptables_bin" >&2
  exit 2
fi

rule=(
  -p udp
  --dport "${start_value}:${end_value}"
  -j REDIRECT
  --to-ports "$target_value"
)

case "${1:-apply}" in
  apply)
    "$iptables_bin" -t nat -C PREROUTING "${rule[@]}" 2>/dev/null ||
      "$iptables_bin" -t nat -I PREROUTING 1 "${rule[@]}"
    ;;
  remove)
    while "$iptables_bin" -t nat -C PREROUTING "${rule[@]}" 2>/dev/null; do
      "$iptables_bin" -t nat -D PREROUTING "${rule[@]}"
    done
    ;;
  status)
    "$iptables_bin" -t nat -C PREROUTING "${rule[@]}"
    ;;
  *)
    echo "Usage: $0 {apply|remove|status}" >&2
    exit 2
    ;;
esac
