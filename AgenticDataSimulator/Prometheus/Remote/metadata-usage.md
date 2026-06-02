# Intent report metadata (`http://intent-reports-metadata`)

Some of the extra functional partners (inSustain, inCoord, inExplain) may want to host Prometheus in their own infrastructure and do actual deployments of workloads to their own Kubernetes cluster as part of the integration with the 5G4Data use-case. The reason can be that they want observational data generated to be real instead of simulated. This document describes how that can be set up.

**What this guide covers:** a partner (example GraphDB user `ericsson`) adds and looks up **where to query each intent metric** on shared **start5g-1** GraphDB. Those locations are stored as `data5g:hasQuery` URLs in the metadata graph `http://intent-reports-metadata`. Point `hasQuery` at **Prometheus** when observations live in the partner’s Prometheus; point it at **GraphDB SPARQL** when observations live in GraphDB. The insert and retrieve steps are the same in both cases—only the URL changes.

Partners may either use **Option A — SimulatorController** to generate intents and register query metadata, or **Option B — partner-managed** intent creation and metadata inserts via the GraphDB HTTP API.

## Architecture overview

How intents and metadata reach GraphDB is **either** of the following (same repository and metadata shape in both cases):


|                           | **Option A — SimulatorController**                                                                            | **Option B — Partner-managed**                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Who writes GraphDB**    | **SimulatorController** (after calling an intent-generating agent)                                            | Partner service or tooling (direct GraphDB HTTP API)                                                                                                             |
| **Intent**                | `discover intent-agent` + `create intent` in the Controller script workspace                                  | Partner creates/stores intent Turtle in the target repository (same ICM/Turtle conventions as the platform)                                                      |
| **Prometheus `hasQuery`** | Controller inserts metadata; **Set Prometheus host** sets only the **URI base** embedded in `data5g:hasQuery` | Partner builds and `INSERT DATA` the same `hasQuery` / optional `hasReadableQuery` triples (see [Insert Prometheus metadata](#insert-prometheus-query-metadata)) |
| **Typical use**           | Interactive scripts, alignment with simulator KG targets and agents                                           | Automated pipelines, CI, or stacks that already own intent lifecycle                                                                                             |


### Option A - use script in SimulatorController to generate intent and query meta data

Minimal [SimulatorController](../../README.md#simulatorcontroller) script that only generates an intent and registers Prometheus query metadata in GraphDB (no `request observation-report` steps). Copy into the Controller script editor.

Before running: create or select a **knowledge graph target**, and in the workspace **Prometheus** panel set the **Prometheus base URL** used as the prefix in `data5g:hasQuery`. If you change that base URL, ensure the Prometheus endpoint is reachable from **IntentReportQueryProxy** — the proxy is a frontend for Grafana and must reach Prometheus to fetch observational data when the Grafana icon next to intents is clicked.

```text
# This is an example SimulatorController script that only generates an intent
# and the associated metadata query in GraphDB. If the Prometheus base URL
# is changed, make sure that the Prometheus endpoint is reachable for the
# IntentReportQueryProxy. The proxy is a frontend for Grafana and it needs
# to be able to reach the Prometheus server to get observational data that
# is displayed in Grafana when the Grafana icon next to intents are clicked.

# Find the intent generating agent for this domain
discover intent-agent by domain telenor.5g4data as intentGen

# Create the intent (NB: set the Prometheus base URL first)
create intent using intentGen storage prometheus prompt "I want to experiment with a small llm in a datacenter near Tromsø/Norway in a sustainable manner" as llmIntent
```

---

## Option B — Partner-managed (GraphDB HTTP API)

The rest of this document is **Option B only**: how a partner service or tooling uses the GraphDB HTTP API on start5g-1 to create repositories, store intent Turtle, and insert or retrieve `data5g:hasQuery` metadata.

Source file paths in backticks (for example `SimulatorController/...`) are relative to the **`AgenticDataSimulator/` repository root**, not this `Prometheus/Remote/` folder.

## Check GraphDB availability


| Check        | Result                                                                              |
| ------------ | ----------------------------------------------------------------------------------- |
| Workbench UI | `https://start5g-1.cs.uit.no/graphdb` — GraphDB Workbench loads (and you can login) |


**Base URL for API calls:** `https://start5g-1.cs.uit.no/graphdb/` (trailing slash optional; paths below are relative to this base).

We have provided a test script that uses curl to perform the steps that follow. If you prefer to read code instead of documentation, see [`test-graphdb-metadata-integration.sh`](test-graphdb-metadata-integration.sh) (run instructions in [Automated integration test](#automated-integration-test-remote-machine)).

---

## Authentication

GraphDB on start5g-1 uses **HTTP Basic authentication**. Each **Option B partner** gets a dedicated GraphDB local user (example partner account: `ericsson`). The platform admin creates the user and password in GraphDB Workbench (or `users.properties`); your service stores them as secrets — never commit passwords to git.

**Environment variables** for partner-managed GraphDB clients:


| Variable           | Example (partner)                      | Purpose                                              |
| ------------------ | -------------------------------------- | ---------------------------------------------------- |
| `GRAPHDB_USERNAME` | `ericsson`                             | GraphDB local username                               |
| `GRAPHDB_PASSWORD` | *(issued by admin)*                    | GraphDB password                                     |
| `GRAPHDB_BASE_URL` | `https://start5g-1.cs.uit.no/graphdb/` | API base for partner HTTP clients                    |
| `GRAPHDB_URL`      | `https://start5g-1.cs.uit.no/graphdb`  | API base (IntentReportQueryProxy; no trailing slash) |


**curl:** pass credentials on every GraphDB request:

```bash
export GRAPHDB_USER="ericsson"
export GRAPHDB_PASSWORD="your-partner-password"

curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" \
  "https://start5g-1.cs.uit.no/graphdb/rest/repositories"
```

**HTTP header** (any client):

```http
Authorization: Basic <base64(ericsson:password)>
```

Without valid credentials, repository and SPARQL calls return **401 Unauthorized**. Repository **create/delete** may be restricted to admin or specific roles depending on GraphDB access-control settings for the `ericsson` user — list and SPARQL on repos you are allowed to read/write should work for metadata integration.

---

## Concepts


| Item                           | Value                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Metadata named graph**       | `http://intent-reports-metadata`                                                                                                                                                           |
| **Vocabulary**                 | `PREFIX data5g: <http://5g4data.eu/5g4data#>`                                                                                                                                              |
| **Metric subject IRI**         | `http://5g4data.eu/5g4data#{compoundMetric}`                                                                                                                                               |
| **Compound metric name**       | `{metricStem}_{conditionId}` — e.g. `p99-token-target_CO3ca6871968564cb89566b37bfb308ba8` (hyphens allowed in the GraphDB/local name; PromQL uses a sanitized metric name without hyphens) |
| **Query link**                 | `data5g:hasQuery` — IRI of an **executable** URL (Prometheus instant query or GraphDB repository query URL)                                                                                |
| **Readable PromQL (optional)** | `data5g:hasReadableQuery` — literal PromQL string for humans and tooling                                                                                                                   |


Metadata is stored **per GraphDB repository**. The simulator default repository is `intents_and_intent_reports`; per-partner KG targets use repository IDs such as `ericsson-5g4data-ericsson-latency-demo`. Your service must use the **same repository ID** as the intent/observation data it relates to.

Observations themselves live in other named graphs (e.g. `http://intent-reports`); only **how to query** a metric is in `http://intent-reports-metadata`.

---

## Create a repository first

Metadata, intent Turtle, and observation triples all live inside a **GraphDB repository**. You must target an existing repository or **create one** before inserting into `http://intent-reports-metadata`.


| Situation                                   | What to do                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Integrating with the shared simulator store | Use existing repo `intents_and_intent_reports` (no create step).        |
| Dedicated experiment / tenant space         | Create a new repository, then use its `repositoryId` in all URLs below. |


**Recommended order (Option B)**

1. **Create repository** — `POST …/rest/repositories` (multipart Turtle config).
2. **Create named graphs** (optional but explicit) — `PUT …/rdf-graphs/service?graph=…` for observation data; metadata graph `http://intent-reports-metadata` is also created automatically on first `INSERT DATA` into that graph.
3. **Intent + metadata** — insert intent Turtle and [Prometheus metadata](#insert-prometheus-query-metadata) via SPARQL UPDATE.
4. **Verify** — [Retrieve Prometheus query](#retrieve-prometheus-query-metadata) for each compound metric.

### Repository ID rules

Use a stable, unique id (letters, digits, `_`, `-` only). As an example, the data generation simulator builds ids as `{domain-slug}-{owner-slug}-{display-name-slug}`, e.g. `ericsson-5g4data-ericsson-latency-demo` from domain `ericsson.5g4data`, owner `ericsson`, display name `latency demo`.

IntentReportQueryProxy accepts ids matching `^[a-z0-9][a-z0-9_-]*$`. Prefer lowercase.

### Create repository (HTTP API)

**Endpoint**

```http
POST https://start5g-1.cs.uit.no/graphdb/rest/repositories
Authorization: Basic …
Content-Type: multipart/form-data; boundary=...
```

**Form field:** `config` — a file named `repo-config.ttl` containing the repository configuration (Turtle). The payload matches what the Simulator Controller uploads (`SimulatorController/src/lib/graphdb/client.ts`).

**Config template** — set `REPOSITORY_ID` and `REPOSITORY_LABEL`:

```turtle
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix rep: <http://www.openrdf.org/config/repository#>.
@prefix sr: <http://www.openrdf.org/config/repository/sail#>.
@prefix sail: <http://www.openrdf.org/config/sail#>.
@prefix graphdb: <http://www.ontotext.com/config/graphdb#>.

[] a rep:Repository ;
    rep:repositoryID "REPOSITORY_ID" ;
    rdfs:label "REPOSITORY_LABEL" ;
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
```

**Success:** HTTP **201** (empty body). If the id already exists, GraphDB returns an error — list repos first or pick another id.

**Verify**

```http
GET https://start5g-1.cs.uit.no/graphdb/rest/repositories/REPOSITORY_ID
Authorization: Basic …
```

### Create a named graph (context)

Observations in the simulator use a per-target graph IRI (e.g. `urn:intend:kg:ericsson-5g4data:ericsson:latency-demo`). Metadata always uses `http://intent-reports-metadata` in the **same** repository.

**Endpoint**

```http
PUT https://start5g-1.cs.uit.no/graphdb/repositories/{repositoryId}/rdf-graphs/service?graph={urlencoded-graph-iri}
Authorization: Basic …
Content-Type: text/turtle
```

**Body:** empty or minimal Turtle. **Success:** HTTP **204**.

You can skip this for `http://intent-reports-metadata` if you only insert metadata via SPARQL UPDATE; GraphDB will create the context on first insert.

### Delete a repository (cleanup)

```http
DELETE https://start5g-1.cs.uit.no/graphdb/rest/repositories/{repositoryId}
Authorization: Basic …
```

Removes the repository and all graphs inside it. Use only for disposable test repos.

---

## Automated integration test (remote machine)

From `AgenticDataSimulator/Prometheus/Remote/` (or copy [`test-graphdb-metadata-integration.sh`](test-graphdb-metadata-integration.sh) to your machine):

```bash
cd Prometheus/Remote   # from AgenticDataSimulator repository root
export GRAPHDB_USER=ericsson
export GRAPHDB_PASSWORD='your-partner-password'
chmod +x test-graphdb-metadata-integration.sh
./test-graphdb-metadata-integration.sh
```

The script creates a disposable repository, creates `http://intent-reports-metadata`, inserts a sample Prometheus `hasQuery`, reads it back, verifies the URL, and deletes the repository (use `--keep-repo` to leave it for inspection). Cleanup only: `REPO=ericsson-metadata-smoke-… ./test-graphdb-metadata-integration.sh --cleanup-only`.

---

## curl examples

Set these once per shell session (adjust `REPO` and `METRIC` for your KG target). **All GraphDB `curl` examples below require** `-u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}"` (see [Authentication](#authentication)).

```bash
export GRAPHDB_BASE="https://start5g-1.cs.uit.no/graphdb"
export GRAPHDB_USER="ericsson"
export GRAPHDB_PASSWORD="your-partner-password"
export REPO="ericsson-5g4data-ericsson-latency-demo"
export METRIC="p99-token-target_CO3ca6871968564cb89566b37bfb308ba8"
```

### Create a new repository

Pick a unique `REPO` (example uses a disposable test id — change it before running):

```bash
export GRAPHDB_BASE="https://start5g-1.cs.uit.no/graphdb"
export GRAPHDB_USER="ericsson"
export GRAPHDB_PASSWORD="your-partner-password"
export REPO="ericsson-5g4data-integration-test"
export REPO_LABEL="Ericsson integration test repository"

cat > /tmp/repo-config.ttl <<EOF
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

curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -w "\nHTTP %{http_code}\n" -X POST "${GRAPHDB_BASE}/rest/repositories" \
  -F "config=@/tmp/repo-config.ttl;type=text/turtle"
```

Confirm the repository exists:

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" "${GRAPHDB_BASE}/rest/repositories/${REPO}" | python3 -m json.tool
```

### Create named graphs in the new repository

Metadata graph (optional explicit create; inserts also create it):

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -w "\nHTTP %{http_code}\n" -X PUT \
  "${GRAPHDB_BASE}/repositories/${REPO}/rdf-graphs/service?graph=$(python3 -c "import urllib.parse; print(urllib.parse.quote('http://intent-reports-metadata', safe=''))")" \
  -H "Content-Type: text/turtle" \
  --data-binary ""
```

Observation graph for intent reports (adjust IRI to your project):

```bash
export OBS_GRAPH="urn:intend:kg:ericsson-5g4data:ericsson:integration-test"

curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -w "\nHTTP %{http_code}\n" -X PUT \
  "${GRAPHDB_BASE}/repositories/${REPO}/rdf-graphs/service?graph=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${OBS_GRAPH}', safe=''))")" \
  -H "Content-Type: text/turtle" \
  --data-binary ""
```

### Delete a test repository (cleanup)

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -w "\nHTTP %{http_code}\n" -X DELETE \
  "${GRAPHDB_BASE}/rest/repositories/${REPO}"
```

### Verify GraphDB is reachable

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -o /dev/null -w "HTTP %{http_code}\n" "${GRAPHDB_BASE}/rest/repositories"
```

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" "${GRAPHDB_BASE}/rest/repositories" | python3 -m json.tool
```

### Repository size (optional)

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" "${GRAPHDB_BASE}/repositories/${REPO}/size"
```

### List all metrics with stored queries

Save the query to a file to avoid shell issues with nested `}` in SPARQL:

```bash
cat > /tmp/list-metadata.rq <<'RQ'
PREFIX data5g: <http://5g4data.eu/5g4data#>
SELECT ?metric ?query ?readable
WHERE {
  GRAPH <http://intent-reports-metadata> {
    ?metric data5g:hasQuery ?query .
    OPTIONAL { ?metric data5g:hasReadableQuery ?readable }
  }
}
ORDER BY ?metric
RQ

curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -X POST "${GRAPHDB_BASE}/repositories/${REPO}" \
  -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/sparql-query" \
  --data-binary @/tmp/list-metadata.rq | python3 -m json.tool
```

### Retrieve query for one metric (shorthand)

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -X POST "${GRAPHDB_BASE}/repositories/${REPO}" \
  -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/sparql-query" \
  --data-binary @- <<'RQ' | python3 -m json.tool
PREFIX data5g: <http://5g4data.eu/5g4data#>
SELECT ?query ?readable
WHERE {
  GRAPH <http://intent-reports-metadata> {
    data5g:p99-token-target_CO3ca6871968564cb89566b37bfb308ba8 data5g:hasQuery ?query .
    OPTIONAL {
      data5g:p99-token-target_CO3ca6871968564cb89566b37bfb308ba8 data5g:hasReadableQuery ?readable .
    }
  }
}
RQ
```

Same query with variables (heredoc must not quote `RQ` so `${METRIC}` expands):

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -X POST "${GRAPHDB_BASE}/repositories/${REPO}" \
  -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/sparql-query" \
  --data-binary @- <<RQ | python3 -m json.tool
PREFIX data5g: <http://5g4data.eu/5g4data#>
SELECT ?query ?readable
WHERE {
  GRAPH <http://intent-reports-metadata> {
    data5g:${METRIC} data5g:hasQuery ?query .
    OPTIONAL { data5g:${METRIC} data5g:hasReadableQuery ?readable }
  }
}
RQ
```

### Retrieve query for one metric (full subject IRI)

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -X POST "${GRAPHDB_BASE}/repositories/${REPO}" \
  -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/sparql-query" \
  --data-binary @- <<RQ | python3 -m json.tool
PREFIX data5g: <http://5g4data.eu/5g4data#>
SELECT ?query ?readable
WHERE {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#${METRIC}> data5g:hasQuery ?query .
    OPTIONAL { <http://5g4data.eu/5g4data#${METRIC}> data5g:hasReadableQuery ?readable }
  }
}
RQ
```

### Retrieve queries for several metrics

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -X POST "${GRAPHDB_BASE}/repositories/${REPO}" \
  -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/sparql-query" \
  --data-binary @- <<'RQ' | python3 -m json.tool
PREFIX data5g: <http://5g4data.eu/5g4data#>
SELECT ?metric ?query ?readable
WHERE {
  GRAPH <http://intent-reports-metadata> {
    VALUES ?metric {
      <http://5g4data.eu/5g4data#p99-token-target_CO3ca6871968564cb89566b37bfb308ba8>
      <http://5g4data.eu/5g4data#throughput_CO6be57670fcad46fba1f648ad28b9cdb5>
    }
    ?metric data5g:hasQuery ?query .
    OPTIONAL { ?metric data5g:hasReadableQuery ?readable }
  }
}
RQ
```

### Extract `hasQuery` URL with `jq`

```bash
PROM_QUERY_URL=$(curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -X POST "${GRAPHDB_BASE}/repositories/${REPO}" \
  -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/sparql-query" \
  --data-binary @- <<RQ | jq -r '.results.bindings[0].query.value'
PREFIX data5g: <http://5g4data.eu/5g4data#>
SELECT ?query WHERE {
  GRAPH <http://intent-reports-metadata> {
    data5g:${METRIC} data5g:hasQuery ?query .
  }
}
RQ
)
echo "$PROM_QUERY_URL"
```

### Run the Prometheus instant query returned from metadata

After `PROM_QUERY_URL` is set (previous step). Prometheus calls do **not** use GraphDB Basic auth:

```bash
curl -sS "${PROM_QUERY_URL}" | python3 -m json.tool
```

For a range query (Grafana-style), rewrite to `query_range` and add time bounds (Unix seconds):

```bash
RANGE_URL=$(echo "$PROM_QUERY_URL" | sed 's|/api/v1/query|/api/v1/query_range|')
START=$(($(date +%s) - 3600))
END=$(date +%s)
curl -sS "${RANGE_URL}&start=${START}&end=${END}&step=60" | python3 -m json.tool
```

### Insert Prometheus metadata

```bash
COMPOUND="p99-token-target_COee91f859b02e48cb8b7b92ff7f039d90"
INTENT_ID="I04fb0697e3a243e7a292c6cb57e9f797"
CONDITION_ID="COee91f859b02e48cb8b7b92ff7f039d90"
PROM_BASE="http://127.0.0.1:9090/prometheus"

SANITIZED="p99tokentarget_COee91f859b02e48cb8b7b92ff7f039d90"
READABLE="${SANITIZED}{job=\"intent_reports\",intent_id=\"${INTENT_ID}\",condition_id=\"${CONDITION_ID}\"}"
ENCODED_QUERY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''${READABLE}'''))")
QUERY_URL="${PROM_BASE}/api/v1/query?query=${ENCODED_QUERY}"

curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -w "\nHTTP %{http_code}\n" -X POST \
  "${GRAPHDB_BASE}/repositories/${REPO}/statements" \
  -H "Content-Type: application/sparql-update" \
  --data-binary @- <<EOF
PREFIX data5g: <http://5g4data.eu/5g4data#>
INSERT DATA {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#${COMPOUND}>
      data5g:hasQuery <${QUERY_URL}> ;
      data5g:hasReadableQuery "${READABLE}" .
  }
}
EOF
```

### Delete metadata for one metric (before re-insert)

```bash
curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -w "\nHTTP %{http_code}\n" -X POST \
  "${GRAPHDB_BASE}/repositories/${REPO}/statements" \
  -H "Content-Type: application/sparql-update" \
  --data-binary @- <<RQ
PREFIX data5g: <http://5g4data.eu/5g4data#>
DELETE {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#${METRIC}> ?p ?o .
  }
}
WHERE {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#${METRIC}> ?p ?o .
  }
}
RQ
```

Then run the insert example again.

### Insert GraphDB observation-query metadata (minimal)

`hasQuery` must be a single-line URL with URL-encoded SPARQL. Build the URL in your app, or use a placeholder and replace:

```bash
COMPOUND="throughput_CO6be57670fcad46fba1f648ad28b9cdb5"
# Pre-encoded SPARQL is long; storeGraphdbMetadata in graphdbTool.ts builds the full query.
GRAPHDB_QUERY_URL="${GRAPHDB_BASE}/repositories/${REPO}?query=SELECT%20%3Fvalue%20WHERE%20%7B%20%3Fs%20%3Fp%20%3Fo%20%7D%20LIMIT%201"

curl -sS -u "${GRAPHDB_USER}:${GRAPHDB_PASSWORD}" -w "\nHTTP %{http_code}\n" -X POST \
  "${GRAPHDB_BASE}/repositories/${REPO}/statements" \
  -H "Content-Type: application/sparql-update" \
  --data-binary @- <<EOF
PREFIX data5g: <http://5g4data.eu/5g4data#>
INSERT DATA {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#${COMPOUND}>
      data5g:hasQuery <${GRAPHDB_QUERY_URL}> .
  }
}
EOF
```

For production GraphDB-backed metrics, copy the exact embedded SPARQL from `storeGraphdbMetadata` in `SimulatorAgentPackages/5g4data-intent-observations/tools/graphdbTool.ts` and URL-encode it into `GRAPHDB_QUERY_URL`.

---

## a) Insert a Prometheus query into `http://intent-reports-metadata`

Use **SPARQL UPDATE** (`INSERT DATA`) against the repository **statements** endpoint. This is the **Option B** mechanism for registering Prometheus-backed query metadata (the same triple shape the platform stores under Option A).

**Endpoint**

```http
POST https://start5g-1.cs.uit.no/graphdb/repositories/{repositoryId}/statements
Authorization: Basic …
Content-Type: application/sparql-update
```

**Body template**

Replace:

- `{repositoryId}` — target repository (e.g. `intents_and_intent_reports` or your KG target repo).
- `{compoundMetric}` — full compound name (e.g. `p99-token-target_COee91f859b02e48cb8b7b92ff7f039d90`).
- `{prometheusQueryUrl}` — Prometheus **instant query** URL (see below).
- `{readablePromql}` — PromQL without URL encoding (escape `"` as `\"` in Turtle strings).

```sparql
PREFIX data5g: <http://5g4data.eu/5g4data#>

INSERT DATA {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#{compoundMetric}>
      data5g:hasQuery <{prometheusQueryUrl}> ;
      data5g:hasReadableQuery "{readablePromql}" .
  }
}
```

**Success:** HTTP **204** or **200** (GraphDB may return either).

**Building the Prometheus URL**

The observation agent stores metadata in the same shape as `buildPrometheusInstantQueryUrl` in the codebase:

1. **Sanitized metric name** — remove characters other than `[a-zA-Z0-9_]` from `{compoundMetric}` (e.g. `p99-token-target_CO…` → `p99tokentarget_CO…`).
2. **Label selector** — `job="intent_reports"`, `intent_id="{intentId}"`, and optionally `condition_id="{conditionId}"` when the condition id is known.
3. **Readable PromQL** — `{sanitizedMetric}{job="intent_reports",intent_id="...",condition_id="..."}`.
4. **Instant query URL** — `{prometheusBase}/api/v1/query?query={urlencode(readablePromql)}`.

`prometheusBase` must be reachable from whatever component **executes** `hasQuery` (e.g. IntentReportQueryProxy on start5g-1 often uses `http://127.0.0.1:9090/prometheus` or `http://127.0.0.1:9090` on the host). Your Option B service stores the URL the **runtime executor** will call, not necessarily a URL reachable from the writer’s network — set `prometheusBase` explicitly in the URL you embed in `hasQuery`.

**curl:** see [Insert Prometheus metadata](#insert-prometheus-metadata) in the [curl examples](#curl-examples) section.

**Upsert / replace:** `INSERT DATA` fails if the subject already exists. To replace, run a `DELETE` for that metric in the metadata graph, then insert again, or use a `DELETE/INSERT` pattern your client prefers.

**Idempotency:** Use the same compound metric IRI the intent/Grafana layer expects. `INSERT DATA` fails if the subject already exists; delete or upsert before re-inserting.

---

## b) SPARQL: retrieve the query for a specific metric

Use **SPARQL SELECT** on the repository root (RDF4J protocol).

**Endpoint**

```http
POST https://start5g-1.cs.uit.no/graphdb/repositories/{repositoryId}
Authorization: Basic …
Accept: application/sparql-results+json
Content-Type: application/sparql-query
```

**Query (one metric by compound name)**

```sparql
PREFIX data5g: <http://5g4data.eu/5g4data#>

SELECT ?query ?readable
WHERE {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#p99-token-target_COee91f859b02e48cb8b7b92ff7f039d90>
      data5g:hasQuery ?query .
    OPTIONAL {
      <http://5g4data.eu/5g4data#p99-token-target_COee91f859b02e48cb8b7b92ff7f039d90>
        data5g:hasReadableQuery ?readable .
    }
  }
}
```

**Query (several metrics)**

```sparql
PREFIX data5g: <http://5g4data.eu/5g4data#>

SELECT ?metric ?query ?readable
WHERE {
  GRAPH <http://intent-reports-metadata> {
    VALUES ?metric {
      <http://5g4data.eu/5g4data#p99-token-target_COee91f859b02e48cb8b7b92ff7f039d90>
      <http://5g4data.eu/5g4data#throughput_CO6be57670fcad46fba1f648ad28b9cdb5>
    }
    ?metric data5g:hasQuery ?query .
    OPTIONAL { ?metric data5g:hasReadableQuery ?readable }
  }
}
```

**Shorthand (local name only)** — same as IntentReportQueryProxy:

```sparql
PREFIX data5g: <http://5g4data.eu/5g4data#>

SELECT ?object
WHERE {
  GRAPH <http://intent-reports-metadata> {
    data5g:p99-token-target_COee91f859b02e48cb8b7b92ff7f039d90 data5g:hasQuery ?object .
  }
}
```

**curl:** see [Retrieve query for one metric](#retrieve-query-for-one-metric-shorthand), [full subject IRI](#retrieve-query-for-one-metric-full-subject-iri), [several metrics](#retrieve-queries-for-several-metrics), and [Extract `hasQuery` URL with `jq](#extract-hasquery-url-with-jq)` above.

**Example JSON binding (live data, Prometheus backend)**

```json
{
  "query": {
    "type": "uri",
    "value": "http://127.0.0.1:9090/api/v1/query?query=p99tokentarget_CO3ca6871968564cb89566b37bfb308ba8%7Bjob%3D%22intent_reports%22%2Cintent_id%3D%22Ic23456362a14430888e24dee7a021974%22%2Ccondition_id%3D%22CO3ca6871968564cb89566b37bfb308ba8%22%7D"
  },
  "readable": {
    "type": "literal",
    "value": "p99tokentarget_CO3ca6871968564cb89566b37bfb308ba8{job=\"intent_reports\",intent_id=\"Ic23456362a14430888e24dee7a021974\",condition_id=\"CO3ca6871968564cb89566b37bfb308ba8\"}"
  }
}
```

**Using the result**


| `hasQuery` URL pattern                                     | Backend    | Next step                                                                                                                            |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Contains `api/v1/query` or `api/v1/query_range` or `:9090` | Prometheus | `GET` the URL for instant samples; for Grafana ranges, IntentReportQueryProxy rewrites to `query_range` with `start`, `end`, `step`. |
| Contains `/repositories/` and `query=`                     | GraphDB    | `GET` or `POST` that URL to run the embedded SPARQL against observation data.                                                        |


To classify backends in application code, see `classifyMetricQueryUrl` in `SimulatorController/src/lib/kg/metric-query-metadata.ts`.

---

## Discovering repositories

**curl:** see [Verify GraphDB is reachable](#verify-graphdb-is-reachable) and [Create a new repository](#create-a-new-repository) in [curl examples](#curl-examples).

Returns JSON objects with `id`, `title`, `readable`, `writable`, and `state`. Pick an existing `id` or create one first, then use that id as `REPO` / `{repositoryId}` in all metadata calls.

---

## Related components in this repo


| Component                                                                 | Role                                                                                                                        |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SimulatorController`                                                     | **Option A** — intent scripts, KG target, Prometheus host, GraphDB inserts via agents                                       |
| `SimulatorAgentPackages/5g4data-intent-observations/tools/graphdbTool.ts` | Reference for metadata triple shape (`storePrometheusMetadata` / `storeGraphdbMetadata`); useful when implementing Option B |
| `SimulatorController/src/lib/kg/metric-query-metadata.ts`                 | Batch metadata lookup (Controller UI; same graph layout as Option B)                                                        |
| `IntentReportQueryProxy/app.py`                                           | Resolves `hasQuery` for Grafana; uses `GRAPHDB_URL`, `GRAPHDB_USERNAME` / `GRAPHDB_PASSWORD`, and `repository_id`           |
| GraphDB partner user (e.g. `ericsson`)                                    | **Option B** — credentials for direct HTTP API calls described in this document                                             |


For Grafana time series, clients typically call **IntentReportQueryProxy** (`http://start5g-1.cs.uit.no:3010`) with `metric_name` and `repository_id` instead of implementing Prometheus range rewriting themselves.

---

## Reference: GraphDB vs Prometheus metadata insert (GraphDB storage)

When observations are stored in GraphDB, `hasQuery` is a **GraphDB repository URL** with an embedded SPARQL `query` parameter (no `hasReadableQuery`). Insert shape:

```sparql
PREFIX data5g: <http://5g4data.eu/5g4data#>

INSERT DATA {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#{compoundMetric}>
      data5g:hasQuery <https://start5g-1.cs.uit.no/graphdb/repositories/{repositoryId}?query={urlencodedSparql}> .
  }
}
```

The embedded SPARQL selects `met:Observation` values for the metric from the observation graph via `SERVICE <repository:{repositoryId}>`. See `storeGraphdbMetadata` in `graphdbTool.ts` for the full query template.