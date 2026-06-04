#!/usr/bin/env bash
# Remove all TSDB samples for one intent by dumping OpenMetrics, filtering, and rebuilding blocks.
# Required when historic remote-write stores out-of-order data: delete_series does not remove OOO samples.
set -euo pipefail

INTENT_ID="${1:-}"
if [[ ! "${INTENT_ID}" =~ ^I[0-9a-f]{32}$ ]]; then
  echo "error: intent id must be canonical I + 32 hex characters" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TSDB_DIR="${PROMETHEUS_TSDB_DIR:-${ROOT}/tsdb}"
COMPOSE_DIR="${PROMETHEUS_COMPOSE_DIR:-${ROOT}}"
IMAGE="${PROMETHEUS_IMAGE:-prom/prometheus:v3.12.0}"
CONTAINER="${PROMETHEUS_CONTAINER:-5g4data-prometheus}"

if [ ! -d "${TSDB_DIR}" ]; then
  echo "error: TSDB directory not found: ${TSDB_DIR}" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

ALL="${WORK}/all.om"
FILTERED="${WORK}/filtered.om"
INTENT_PATTERN="intent_id=\"${INTENT_ID}\""

stop_prometheus() {
  if docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    docker compose -f "${COMPOSE_DIR}/docker-compose.yml" stop prometheus
  fi
}

start_prometheus() {
  docker compose -f "${COMPOSE_DIR}/docker-compose.yml" start prometheus
}

echo "Stopping Prometheus..."
stop_prometheus

echo "Dumping TSDB to OpenMetrics..."
docker run --rm --entrypoint promtool \
  -v "${TSDB_DIR}:/data:rw" \
  "${IMAGE}" \
  tsdb dump-openmetrics /data --sandbox-dir-root=/data > "${ALL}"

if grep -q "${INTENT_PATTERN}" "${ALL}"; then
  echo "Filtering out intent ${INTENT_ID}..."
  grep -v "${INTENT_PATTERN}" "${ALL}" > "${FILTERED}" || true
else
  echo "No samples for intent ${INTENT_ID} in TSDB dump; leaving database unchanged."
  start_prometheus
  exit 0
fi

echo "Rewriting TSDB without intent ${INTENT_ID}..."
docker run --rm -v "${TSDB_DIR}:/data" alpine:3.20 sh -c 'rm -rf /data/*'
docker run --rm -v "${WORK}:/work:ro" -v "${TSDB_DIR}:/data" alpine:3.20 cp /work/filtered.om /data/filtered.om
docker run --rm --entrypoint promtool \
  -v "${TSDB_DIR}:/data:rw" \
  "${IMAGE}" \
  tsdb create-blocks-from openmetrics /data/filtered.om /data
docker run --rm -v "${TSDB_DIR}:/data" alpine:3.20 rm -f /data/filtered.om

echo "Starting Prometheus..."
start_prometheus

echo "TSDB rewrite complete for intent ${INTENT_ID}."
