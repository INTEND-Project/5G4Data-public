#!/usr/bin/env bash
# Delete all time-series data in Prometheus and clear Pushgateway pushed metrics.
# TSDB and Pushgateway state live in the container filesystem (no bind mounts), so
# removing and recreating the containers wipes all stored metrics.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required" >&2
  exit 1
fi

export PROMETHEUS_EXTERNAL_URL="${PROMETHEUS_EXTERNAL_URL:-http://127.0.0.1:9090}"

CONTAINERS=(5g4data-prometheus 5g4data-pushgateway)
running=false
for c in "${CONTAINERS[@]}"; do
  if docker ps --format '{{.Names}}' | grep -qx "$c"; then
    running=true
    break
  fi
done

if ! $running && ! docker ps -a --format '{{.Names}}' | grep -qx '5g4data-prometheus'; then
  echo "Prometheus stack is not running and no containers exist; nothing to delete."
  exit 0
fi

echo "Stopping Prometheus and Pushgateway..."
docker compose stop prometheus pushgateway 2>/dev/null || true

for c in "${CONTAINERS[@]}"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    echo "Removing $c (wipes stored metrics)..."
    docker rm "$c"
  fi
done

echo "Starting Prometheus stack..."
docker compose up -d

echo ""
echo "All Prometheus TSDB data and Pushgateway metrics have been deleted."
echo "Prometheus:  http://127.0.0.1:9090"
echo "Pushgateway: http://127.0.0.1:9091"
