#!/usr/bin/env bash
# Configure Grafana SPARQL datasource for GraphDB HTTP Basic auth (user telenor by default).
#
# Reads GRAPHDB_* and GRAFANA_* from SimulatorController/.env, updates the live
# flandersmake-sparql-datasource via Grafana HTTP API (no container recreate required).
#
# Usage:
#   ./Grafana/configure-graphdb-datasource.sh
#
# After changing credentials, also restart Grafana so provisioning/env stay in sync:
#   ./Grafana/configure-jwt-auth.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTROLLER_ENV="${ROOT}/SimulatorController/.env"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
fi

read_env_var() {
  local key="$1"
  grep -E "^[[:space:]]*${key}=" "${CONTROLLER_ENV}" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^["'\'' ]*//' -e 's/["'\'' ]*$//' || true
}

GRAPHDB_BASE_URL="${GRAPHDB_BASE_URL:-$(read_env_var GRAPHDB_BASE_URL)}"
GRAPHDB_BASE_URL="${GRAPHDB_BASE_URL:-https://start5g-1.cs.uit.no/graphdb/}"
GRAPHDB_BASE_URL="${GRAPHDB_BASE_URL%/}"
GRAPHDB_USERNAME="${GRAPHDB_USERNAME:-$(read_env_var GRAPHDB_USERNAME)}"
GRAPHDB_USERNAME="${GRAPHDB_USERNAME:-telenor}"
GRAPHDB_PASSWORD="${GRAPHDB_PASSWORD:-$(read_env_var GRAPHDB_PASSWORD)}"
GRAPHDB_REPOSITORY="${GRAPHDB_REPOSITORY:-intents_and_intent_reports}"

GRAFANA_BASE_URL="${GRAFANA_BASE_URL:-$(read_env_var GRAFANA_BASE_URL)}"
GRAFANA_BASE_URL="${GRAFANA_BASE_URL:-http://start5g-1.cs.uit.no:3002}"
GRAFANA_BASE_URL="${GRAFANA_BASE_URL%/}"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-$(read_env_var GRAFANA_ADMIN_USER)}"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-$(read_env_var GRAFANA_ADMIN_PASSWORD)}"

if [[ -z "${GRAPHDB_PASSWORD}" ]]; then
  echo "error: set GRAPHDB_PASSWORD in ${CONTROLLER_ENV}" >&2
  exit 1
fi
if [[ -z "${GRAFANA_ADMIN_PASSWORD}" ]]; then
  echo "error: set GRAFANA_ADMIN_PASSWORD in ${CONTROLLER_ENV}" >&2
  exit 1
fi

GRAPHDB_SPARQL_SOURCE="${GRAPHDB_BASE_URL}/repositories/${GRAPHDB_REPOSITORY}"

auth_args=(-u "${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASSWORD}")

echo "Fetching Grafana datasources ..."
DATASOURCES_JSON="$(curl -sS "${auth_args[@]}" "${GRAFANA_BASE_URL}/api/datasources")"

DS_ID="$(printf '%s' "${DATASOURCES_JSON}" | node -e "
const list = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const match = list.find((ds) => ds.type === 'flandersmake-sparql-datasource');
if (!match) {
  console.error('No flandersmake-sparql-datasource found');
  process.exit(1);
}
process.stdout.write(String(match.id));
")"

echo "Updating datasource id=${DS_ID} (user=${GRAPHDB_USERNAME}, source=${GRAPHDB_SPARQL_SOURCE}) ..."

payload="$(node -e "
const source = process.argv[1];
const user = process.argv[2];
const pass = process.argv[3];
const bearer = Buffer.from(user + ':' + pass).toString('base64');
console.log(JSON.stringify({
  id: Number(process.argv[4]),
  name: 'flandersmake-sparql-datasource',
  type: 'flandersmake-sparql-datasource',
  access: 'proxy',
  isDefault: true,
  basicAuth: true,
  basicAuthUser: user,
  jsonData: { pdcInjected: false, source, username: user },
  secureJsonData: { basicAuthPassword: pass, password: pass, bearer },
}));
" "${GRAPHDB_SPARQL_SOURCE}" "${GRAPHDB_USERNAME}" "${GRAPHDB_PASSWORD}" "${DS_ID}")"

response="$(curl -sS "${auth_args[@]}" \
  -H 'Content-Type: application/json' \
  -X PUT "${GRAFANA_BASE_URL}/api/datasources/${DS_ID}" \
  -d "${payload}")"

printf '%s\n' "${response}" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const msg = (data.message || '').toLowerCase();
if (msg.includes('read-only')) {
  console.log('OK: datasource is provisioned (read-only via API); check basicAuth in GET /api/datasources');
  process.exit(0);
}
if (msg.includes('updated')) {
  console.log('OK:', data.message);
  process.exit(0);
}
if (data.datasource) {
  console.log('OK: datasource', data.datasource.name);
  process.exit(0);
}
console.error(JSON.stringify(data, null, 2));
process.exit(1);
"

echo "Testing GraphDB SPARQL with same credentials ..."
code="$(curl -sS -o /dev/null -w '%{http_code}' -u "${GRAPHDB_USERNAME}:${GRAPHDB_PASSWORD}" \
  -X POST "${GRAPHDB_SPARQL_SOURCE}" \
  -H 'Accept: application/sparql-results+json' \
  -H 'Content-Type: application/sparql-query' \
  --data-binary 'SELECT (COUNT(*) AS ?c) WHERE { ?s ?p ?o } LIMIT 1')"
if [[ "${code}" != "200" ]]; then
  echo "warning: direct GraphDB test returned HTTP ${code}" >&2
else
  echo "GraphDB SPARQL auth OK (HTTP 200)"
fi
