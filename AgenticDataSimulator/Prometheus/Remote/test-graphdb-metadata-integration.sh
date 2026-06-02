#!/usr/bin/env bash
# End-to-end smoke test for GraphDB intent-report metadata (remote / partner machine).
#
# Creates a disposable repository, ensures GRAPH <http://intent-reports-metadata>,
# inserts a Prometheus hasQuery triple, reads it back, and verifies the URL.
#
# Prerequisites: curl, python3
#
# Usage:
export GRAPHDB_USER=ericsson
export GRAPHDB_PASSWORD='your password here' # Or set in env
#   ./test-graphdb-metadata-integration.sh
#
# Optional environment:
export GRAPHDB_BASE=https://start5g-1.cs.uit.no/graphdb
export REPO=ericsson-metadata-smoke-YYYYMMDD-HHMMSS
export REPO_LABEL="Ericsson metadata integration smoke test"
export PROM_BASE=https://start5g-1.cs.uit.no/prometheus
export KEEP_REPO=1    # delete the repository on success
#
# Flags:
#   --keep-repo    keep repository after success (same as KEEP_REPO=1)
#   --cleanup-only REPO=...  delete repository and exit (no create/insert)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

METADATA_GRAPH="http://intent-reports-metadata"
COMPOUND_METRIC="p99-token-target_COee91f859b02e48cb8b7b92ff7f039d90"
INTENT_ID="I04fb0697e3a243e7a292c6cb57e9f797"
CONDITION_ID="COee91f859b02e48cb8b7b92ff7f039d90"

GRAPHDB_BASE="${GRAPHDB_BASE:-https://start5g-1.cs.uit.no/graphdb}"
GRAPHDB_BASE="${GRAPHDB_BASE%/}"
GRAPHDB_USER="${GRAPHDB_USER:-${GRAPHDB_USERNAME:-ericsson}}"
GRAPHDB_PASSWORD="${GRAPHDB_PASSWORD:-}"
REPO="${REPO:-ericsson-metadata-smoke-$(date +%Y%m%d-%H%M%S)}"
# Unset REPO or omit it for a timestamped id; do not copy the YYYYMMDD-HHMMSS placeholder literally.
if [[ "$REPO" == *YYYYMMDD* || "$REPO" == *HHMMSS* ]]; then
  echo "warning: REPO looked like a doc placeholder; using timestamped id instead" >&2
  REPO="ericsson-metadata-smoke-$(date +%Y%m%d-%H%M%S)"
fi
REPO_LABEL="${REPO_LABEL:-Ericsson metadata integration smoke test}"
PROM_BASE="${PROM_BASE:-https://start5g-1.cs.uit.no/prometheus}"
PROM_BASE="${PROM_BASE%/}"

KEEP_REPO="${KEEP_REPO:-0}"
CLEANUP_ONLY=0

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --keep-repo)
      KEEP_REPO=1
      shift
      ;;
    --cleanup-only)
      CLEANUP_ONLY=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_cmd() {
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "error: required command not found: ${cmd}" >&2
      exit 2
    fi
  done
}

require_cmd curl python3

if [[ -z "$GRAPHDB_PASSWORD" ]]; then
  echo "error: set GRAPHDB_PASSWORD (and optionally GRAPHDB_USER, default ericsson)" >&2
  exit 2
fi

CURL_AUTH=(-u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}")

log() {
  printf '==> %s\n' "$*"
}

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

expect_http() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  local body="${4:-}"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL: %s — expected HTTP %s, got %s\n' "$label" "$expected" "$actual" >&2
    if [[ -n "$body" ]]; then
      printf '%s\n' "$body" >&2
    fi
    exit 1
  fi
}

graphdb_request() {
  local method="$1"
  local url="$2"
  local content_type="${3:-}"
  local body_file="${4:-}"
  local accept="${5:-}"
  local body_out
  body_out="$(mktemp)"
  local -a curl_args=(-sS "${CURL_AUTH[@]}" -o "$body_out" -w '%{http_code}' -X "$method" "$url")
  if [[ -n "$content_type" ]]; then
    curl_args+=(-H "Content-Type: ${content_type}")
  fi
  if [[ -n "$accept" ]]; then
    curl_args+=(-H "Accept: ${accept}")
  fi
  if [[ -n "$body_file" ]]; then
    curl_args+=(--data-binary "@${body_file}")
  elif [[ "$method" == "PUT" || "$method" == "POST" ]]; then
    curl_args+=(--data-binary "")
  fi
  local code
  code="$(curl "${curl_args[@]}" 2>/dev/null || echo "000")"
  printf '%s\n' "$code"
  cat "$body_out"
  rm -f "$body_out"
}

build_prom_query_url() {
  python3 - <<'PY'
import os
import re
import urllib.parse

compound = os.environ["COMPOUND_METRIC"]
intent_id = os.environ["INTENT_ID"]
condition_id = os.environ["CONDITION_ID"]
prom_base = os.environ["PROM_BASE"].rstrip("/")

sanitized = re.sub(r"[^a-zA-Z0-9_]", "", compound)
readable = (
    f'{sanitized}{{job="intent_reports",intent_id="{intent_id}",'
    f'condition_id="{condition_id}"}}'
)
encoded = urllib.parse.quote(readable, safe="")
query_url = f"{prom_base}/api/v1/query?query={encoded}"
print(readable)
print(query_url)
PY
}

write_repo_config() {
  local path="$1"
  cat >"$path" <<EOF
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix rep: <http://www.openrdf.org/config/repository#>.
@prefix sr: <http://www.openrdf.org/config/repository/sail#>.
@prefix sail: <http://www.openrdf.org/config/sail#>.
@prefix graphdb: <http://www.ontotext.com/config/graphdb#>.

[] a rep:Repository ;
    rep:repositoryID "${REPO}" ;
    rdfs:label "${REPO_LABEL}" ;
    rep:repositoryImpl [
        rep:repositoryType "graphdb:SailRepository" ;
        sr:sailImpl [
            sail:sailType "graphdb:Sail" ;
            graphdb:read-only "false" ;
            graphdb:ruleset "rdfsplus-optimized" ;
            graphdb:disable-sameAs "true" ;
            graphdb:check-for-inconsistencies "false" ;
            graphdb:entity-id-size "32" ;
            graphdb:enable-context-index "false" ;
            graphdb:enablePredicateList "true" ;
            graphdb:enable-fts-index "false" ;
            graphdb:fts-indexes ("default" "iri") ;
            graphdb:fts-string-literals-index "default" ;
            graphdb:fts-iris-index "none" ;
            graphdb:query-timeout "0" ;
            graphdb:throw-QueryEvaluationException-on-timeout "false" ;
            graphdb:query-limit-results "0" ;
            graphdb:base-URL "http://example.org/owlim#" ;
            graphdb:defaultNS "" ;
            graphdb:imports "" ;
            graphdb:repository-type "file-repository" ;
            graphdb:storage-folder "storage" ;
            graphdb:entity-index-size "10000000" ;
            graphdb:in-memory-literal-properties "true" ;
            graphdb:enable-literal-index "true" ;
        ]
    ].
EOF
}

delete_repository() {
  log "Deleting repository ${REPO}"
  local response code body
  response="$(graphdb_request DELETE "${GRAPHDB_BASE}/rest/repositories/${REPO}")"
  code="$(printf '%s' "$response" | head -n1)"
  body="$(printf '%s' "$response" | tail -n +2)"
  if [[ "$code" != "204" && "$code" != "200" && "$code" != "404" ]]; then
    fail "delete repository returned HTTP ${code}: ${body}"
  fi
}

check_auth() {
  log "Checking GraphDB auth (${GRAPHDB_USER} @ ${GRAPHDB_BASE})"
  local response code body
  response="$(graphdb_request GET "${GRAPHDB_BASE}/rest/repositories")"
  code="$(printf '%s' "$response" | head -n1)"
  body="$(printf '%s' "$response" | tail -n +2)"
  expect_http "list repositories" "200" "$code" "$body"
}

create_repository() {
  log "Creating repository ${REPO}"
  local config
  config="$(mktemp)"
  write_repo_config "$config"
  local response code body
  response="$(
    curl -sS "${CURL_AUTH[@]}" -o /tmp/graphdb-create-body.txt -w '%{http_code}' \
      -X POST "${GRAPHDB_BASE}/rest/repositories" \
      -F "config=@${config};type=text/turtle" 2>/dev/null || echo "000"
  )"
  code="$response"
  body="$(cat /tmp/graphdb-create-body.txt 2>/dev/null || true)"
  rm -f "$config" /tmp/graphdb-create-body.txt
  if [[ "$code" == "201" ]]; then
    return 0
  fi
  if [[ "$code" == "409" || "$code" == "400" ]]; then
    log "Repository may already exist (HTTP ${code}); continuing"
    return 0
  fi
  fail "create repository returned HTTP ${code}: ${body}"
}

create_metadata_graph() {
  log "Creating named graph ${METADATA_GRAPH}"
  local encoded
  encoded="$(python3 -c "import urllib.parse; print(urllib.parse.quote('${METADATA_GRAPH}', safe=''))")"
  local response code body
  response="$(graphdb_request PUT \
    "${GRAPHDB_BASE}/repositories/${REPO}/rdf-graphs/service?graph=${encoded}" \
    "text/turtle" \
    "")"
  code="$(printf '%s' "$response" | head -n1)"
  body="$(printf '%s' "$response" | tail -n +2)"
  expect_http "create metadata graph" "204" "$code" "$body"
}

insert_metadata() {
  export COMPOUND_METRIC INTENT_ID CONDITION_ID PROM_BASE METADATA_GRAPH
  local readable query_url readable_escaped
  readable="$(build_prom_query_url | sed -n '1p')"
  query_url="$(build_prom_query_url | sed -n '2p')"
  readable_escaped="$(printf '%s' "$readable" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  EXPECTED_QUERY_URL="$query_url"
  EXPECTED_READABLE="$readable"

  log "Inserting Prometheus metadata for ${COMPOUND_METRIC}"
  local update
  update="$(mktemp)"
  cat >"$update" <<EOF
PREFIX data5g: <http://5g4data.eu/5g4data#>
INSERT DATA {
  GRAPH <${METADATA_GRAPH}> {
    <http://5g4data.eu/5g4data#${COMPOUND_METRIC}>
      data5g:hasQuery <${query_url}> ;
      data5g:hasReadableQuery "${readable_escaped}" .
  }
}
EOF

  local response code body
  response="$(graphdb_request POST \
    "${GRAPHDB_BASE}/repositories/${REPO}/statements" \
    "application/sparql-update" \
    "$update")"
  code="$(printf '%s' "$response" | head -n1)"
  body="$(printf '%s' "$response" | tail -n +2)"
  rm -f "$update"
  if [[ "$code" != "204" && "$code" != "200" ]]; then
    fail "insert metadata returned HTTP ${code}: ${body}"
  fi
}

read_metadata() {
  log "Reading metadata via SPARQL"
  local query
  query="$(mktemp)"
  cat >"$query" <<EOF
PREFIX data5g: <http://5g4data.eu/5g4data#>
SELECT ?query ?readable
WHERE {
  GRAPH <${METADATA_GRAPH}> {
    data5g:${COMPOUND_METRIC} data5g:hasQuery ?query .
    OPTIONAL { data5g:${COMPOUND_METRIC} data5g:hasReadableQuery ?readable }
  }
}
EOF

  local response code body
  response="$(graphdb_request POST \
    "${GRAPHDB_BASE}/repositories/${REPO}" \
    "application/sparql-query" \
    "$query" \
    "application/sparql-results+json")"
  code="$(printf '%s' "$response" | head -n1)"
  body="$(printf '%s' "$response" | tail -n +2)"
  rm -f "$query"
  expect_http "SPARQL select" "200" "$code" "$body"

  READ_BACK_QUERY_URL="$(printf '%s' "$body" | python3 -c "
import json, sys
data = json.load(sys.stdin)
bindings = data.get('results', {}).get('bindings', [])
if not bindings:
    raise SystemExit('no bindings')
row = bindings[0]
print(row.get('query', {}).get('value', ''))
")"
  READ_BACK_READABLE="$(printf '%s' "$body" | python3 -c "
import json, sys
data = json.load(sys.stdin)
bindings = data.get('results', {}).get('bindings', [])
if not bindings:
    raise SystemExit('no bindings')
row = bindings[0]
print(row.get('readable', {}).get('value', ''))
")"
}

verify_readback() {
  log "Verifying read-back matches insert"
  if [[ "$READ_BACK_QUERY_URL" != "$EXPECTED_QUERY_URL" ]]; then
    printf '  expected query: %s\n' "$EXPECTED_QUERY_URL" >&2
    printf '  actual query:   %s\n' "$READ_BACK_QUERY_URL" >&2
    fail "hasQuery URL mismatch"
  fi
  if [[ "$READ_BACK_READABLE" != "$EXPECTED_READABLE" ]]; then
    printf '  expected readable: %s\n' "$EXPECTED_READABLE" >&2
    printf '  actual readable:   %s\n' "$READ_BACK_READABLE" >&2
    fail "hasReadableQuery mismatch"
  fi
}

main() {
  if [[ "$CLEANUP_ONLY" == "1" ]]; then
    delete_repository
    echo "OK: cleaned up repository ${REPO}"
    exit 0
  fi

  echo "GraphDB metadata integration test"
  echo "  base:  ${GRAPHDB_BASE}"
  echo "  user:  ${GRAPHDB_USER}"
  echo "  repo:  ${REPO}"
  echo

  check_auth
  create_repository
  create_metadata_graph
  insert_metadata
  read_metadata
  verify_readback

  echo
  echo "PASS: repository ${REPO}"
  echo "  metadata graph: ${METADATA_GRAPH}"
  echo "  metric:         ${COMPOUND_METRIC}"
  echo "  hasQuery:       ${READ_BACK_QUERY_URL}"

  if [[ "$KEEP_REPO" == "1" ]]; then
    echo "  (repository kept — set KEEP_REPO=0 or omit --keep-repo to delete on success)"
  else
    delete_repository
    echo "  (repository deleted)"
  fi
}

main "$@"
