#!/usr/bin/env bash
# Retire only the updater. The Agent executable and proxy services stay in place.
set -euo pipefail
exec python3 "$(dirname -- "$0")/remove-agent-updater.py" "$@"
