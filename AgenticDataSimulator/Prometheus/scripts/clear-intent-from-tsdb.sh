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
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.yml"
IMAGE="${PROMETHEUS_IMAGE:-prom/prometheus:v3.12.0}"
CONTAINER="${PROMETHEUS_CONTAINER:-5g4data-prometheus}"

if [ ! -d "${TSDB_DIR}" ]; then
  echo "error: TSDB directory not found: ${TSDB_DIR}" >&2
  exit 1
fi

WORK="$(mktemp -d)"
PROMETHEUS_WAS_STOPPED=0

ALL="${WORK}/all.om"
FILTERED="${WORK}/filtered.om"
INTENT_PATTERN="intent_id=\"${INTENT_ID}\""

compose() {
  docker compose --project-directory "${COMPOSE_DIR}" -f "${COMPOSE_FILE}" "$@"
}

fix_tsdb_permissions() {
  docker run --rm --user root --entrypoint chown \
    -v "${TSDB_DIR}:/prometheus" \
    "${IMAGE}" \
    -R 65534:65534 /prometheus
}

stop_prometheus() {
  if docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    compose stop prometheus
    PROMETHEUS_WAS_STOPPED=1
  fi
}

ensure_prometheus_running() {
  if docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    return 0
  fi

  fix_tsdb_permissions
  compose up -d prometheus
  echo "Prometheus container started." >&2
}

cleanup() {
  # Never let cleanup failures leave Prometheus stopped after we took it down.
  set +e
  if [ "${PROMETHEUS_WAS_STOPPED}" -eq 1 ]; then
    ensure_prometheus_running
  fi
  rm -rf "${WORK}"
}

trap cleanup EXIT

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
fix_tsdb_permissions

echo "TSDB rewrite complete for intent ${INTENT_ID}."
