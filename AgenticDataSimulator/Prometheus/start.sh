#!/usr/bin/env bash
# Start Prometheus (:9090) and Pushgateway (:9091) for intent observation metrics.
# Caddy on start5g-1 proxies https://start5g-1.cs.uit.no/prometheus and /prometheus-pushgateway.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required" >&2
  exit 1
fi

# Behind Caddy subpath on start5g-1:
#   export PROMETHEUS_EXTERNAL_URL=https://start5g-1.cs.uit.no/prometheus
export PROMETHEUS_EXTERNAL_URL="${PROMETHEUS_EXTERNAL_URL:-http://127.0.0.1:9090}"

docker compose up -d

echo ""
echo "Pushgateway: http://127.0.0.1:9091"
echo "             (agent PUSHGATEWAY_URL …/metrics/job/intent_reports)"
echo "Prometheus:  http://127.0.0.1:9090"
echo "             (agent PROMETHEUS_URL for metadata query URLs)"
echo ""
echo "Stop:  docker compose -f ${ROOT}/docker-compose.yml down"
