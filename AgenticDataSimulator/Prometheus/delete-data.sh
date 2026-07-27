#!/usr/bin/env bash
# Delete all time-series data in Prometheus and clear Pushgateway pushed metrics.
# Removes Prometheus/tsdb/ and recreates containers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required" >&2
  exit 1
fi

TSDB_DIR="${ROOT}/tsdb"
has_stack=false
if docker ps -a --format '{{.Names}}' | grep -qx '5g4data-prometheus'; then
  has_stack=true
elif [ -d "$TSDB_DIR" ]; then
  has_stack=true
fi

if ! $has_stack; then
  echo "Prometheus stack is not running and no TSDB directory exists; nothing to delete."
  exit 0
fi

echo "Stopping Prometheus and Pushgateway..."
docker compose down

if [ -d "$TSDB_DIR" ]; then
  echo "Removing TSDB directory $TSDB_DIR..."
  # Prometheus writes TSDB files as nobody (65534); remove via container as root.
  docker run --rm -v "${ROOT}:/work" alpine:3.20 sh -c 'rm -rf /work/tsdb'
fi

echo "Starting Prometheus stack..."
"${ROOT}/start.sh"

echo ""
echo "All Prometheus TSDB data and Pushgateway metrics have been deleted."
