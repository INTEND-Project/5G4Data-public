#!/usr/bin/env bash
# Provision Grafana logins for all Controller users (see provision-grafana-users.ts).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f "${ROOT}/.env" ]; then
  echo "error: missing ${ROOT}/.env" >&2
  exit 1
fi

exec npx tsx scripts/provision-grafana-users.ts "$@"
