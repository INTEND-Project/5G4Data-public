#!/usr/bin/env bash
# Convert the synthetic edge-DC CSV to Turtle and load it into the
# telenor-infrastructure-5g4data repository's infra named graph.
#
# Idempotent: uses HTTP PUT to the named-graph store, which REPLACES the graph
# contents each run (no duplicate triples on re-load).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GRAPHDB_URL="${GRAPHDB_URL:-http://localhost:7200}"
REPO="${GRAPHDB_INFRA_REPOSITORY_ID:-telenor-infrastructure-5g4data}"
GRAPH="${GRAPHDB_INFRA_NAMED_GRAPH:-http://intendproject.eu/telenor/infra}"
TTL="${HERE}/nordic_edge_infra.ttl"

echo "==> Generating Turtle from CSV"
python3 "${HERE}/csv_to_infra_ttl.py" --out "${TTL}"

echo "==> Loading into ${GRAPHDB_URL}/repositories/${REPO} (graph ${GRAPH})"
# PUT replaces the named graph; use rdf-graphs service with graph= param.
curl -sf -X PUT \
  "${GRAPHDB_URL}/repositories/${REPO}/rdf-graphs/service?graph=${GRAPH}" \
  -H "Content-Type: text/turtle" \
  --data-binary @"${TTL}"

echo
echo "==> Verifying edge cluster count"
curl -sf -X POST "${GRAPHDB_URL}/repositories/${REPO}" \
  -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "query=PREFIX schema: <https://intendproject.eu/schema/>
SELECT (COUNT(?dc) AS ?count) WHERE {
  GRAPH <${GRAPH}> { ?dc a schema:edgeCluster . }
}"
echo
echo "Done."
