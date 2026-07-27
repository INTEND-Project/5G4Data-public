# Runbook — local intent → deploy → energy-report chain

Verified working end-to-end on **2026-07-27**. This is the local (no-UiT) chain
that takes a TM Forum intent, deploys the workload, and produces an InSustain
energy report with `icm:isMet` evaluated against the intent's thresholds.

```
POST intent (DE + SE)
  → inServ :3021          parse + split
      ├── DeploymentExpectation  → mock-inorch :3020   → helm upgrade --install → pod on inHouse k3s
      └── SustainabilityExpectation → InSustain :30089 → auto-register workload → Kepler → intent report
```

Both legs run from a **single** POST. inServ forwards the *full* intent to each
handler; each ignores the expectations that aren't its own.

**Reference result:** `1.9845 W` / `595.36 J` measured against thresholds
`300 W` / `100 MJ` → `isMet: true`, intent `acknowledged → active`.

---

## Prerequisites

| Thing | How it's satisfied here |
|---|---|
| GraphDB on `localhost:7200` | `AgenticDataSimulator/GraphDB` docker compose — see `AgenticDataSimulator/SETUP-LOCAL.md` |
| inHouse k3s reachable at `localhost:6443` | `ssh -fN node0ext` tunnel (the user maintains this) |
| InSustain deployed **with RBAC** | `./scripts/deploy.sh --target inhouse --enable-full-rbac -y` in the `iintend-uc3` repo. Not optional — see [Gotchas](#gotchas). |
| InSustain backend reachable on the host | `kubectl --context inHouse -n insustain port-forward svc/insustain-backend 30089:8089` |
| `helm` + `kubectl` on PATH | mock-inorch shells out to `helm` with `--kube-context inHouse` |
| inServ SE-routing code | 5-file cherry-pick from `feature/insustain-routing` — see [inServ SE routing](#inserv-se-routing-is-not-on-main) |

---

## Cold start

### 1. GraphDB — the EC_31 routing triple

inServ resolves the inOrch endpoint for a `data5g:DataCenter` by SPARQL
(`inServ/src/inserv/services/infrastructure_service.py:_query_graphdb_for_datacenter`).
It is hardcoded to subject namespace `spo: <https://intendproject.eu/telenor/>`
in graph `<http://intendproject.eu/telenor/infra>`, and it queries **the same
repository it stores intents in** (one `GraphDbClient` is shared by
`InfrastructureService` and `IntentRouter` — see `inServ/src/inserv/__init__.py`).

So the triple goes into the **intent** repo — the one `GRAPHDB_REPOSITORY` names:

```bash
REPO=<your-intent-repo>     # the value you set for GRAPHDB_REPOSITORY below

curl -X POST -H 'Content-Type: application/sparql-update' \
  --data-urlencode 'update=
    PREFIX spo:   <https://intendproject.eu/telenor/>
    PREFIX aeros: <https://aeros.eu/schema/>
    INSERT DATA {
      GRAPH <http://intendproject.eu/telenor/infra> {
        spo:EC_31 aeros:domain "localhost:3020" .
      }
    }' \
  "http://localhost:7200/repositories/$REPO/statements"
```

Expect `HTTP 204`. Verify with inServ's own query:

```bash
curl -s "http://localhost:7200/repositories/$REPO" \
  -H 'Accept: application/sparql-results+json' \
  --data-urlencode 'query=
    PREFIX spo:   <https://intendproject.eu/telenor/>
    PREFIX aeros: <https://aeros.eu/schema/>
    SELECT ?d WHERE { GRAPH <http://intendproject.eu/telenor/infra> {
      spo:EC_31 aeros:domain ?d } }'
```

Notes on the value:
- A **bare host:port** literal is wrapped by inServ into
  `http://localhost:3020/tmf-api/intentManagement/v5/` and `/intent` is appended.
  A value starting with `http(s)://` is used as-is (a trailing `/` is added).
- Use the host as reachable from the **inServ process**. inServ runs on the host
  here, so `localhost:3020`. If inServ were containerized on `mlflow-network`,
  use the mock's host-gateway address instead.
- inServ tries DataCenter formats `EC_31` then `EC31`, so `spo:EC_31` matches
  an intent that says `data5g:DataCenter "EC_31"`.

> Do **not** repoint `GRAPHDB_REPOSITORY` at `telenor-infrastructure-5g4data` to
> pick up the synthetic infra graph. That repo's DCs are in the
> `https://intendproject.eu/schema/` namespace (so the query misses anyway) and
> carry no `aeros:domain` triple at all — and because the repo is shared,
> repointing breaks intent persistence.

### 2. mock-inorch (:3020)

```bash
cd telenor/repo/mock-inorch
. .venv/bin/activate      # created once: python -m venv .venv && pip install -r requirements.txt

MOCK_INORCH_KUBE_CONTEXT=inHouse \
MOCK_INORCH_HELM_SET='intent.enabled=false,kpiProfile.enabled=false,openWebUI.enabled=false,image.repository=nginxinc/nginx-unprivileged,image.tag=alpine,image.pullPolicy=IfNotPresent,resources.requests.memory=256Mi,resources.limits.memory=512Mi,service.type=ClusterIP' \
python app.py
```

```bash
curl -s localhost:3020/health | jq   # {"status":"ok","role":"mock-inorch",...}
```

The long `MOCK_INORCH_HELM_SET` is the **public-image substitution**: rusty-llm's
real image `ghcr.io/arne-munch-ellingsen/rusty_llm:latest` is private (403 even
with a valid `gh` token), so the chart is installed with `nginx-unprivileged`
standing in for the LLM. `openWebUI.enabled=false` also drops a hostPath volume
that would otherwise pollute the energy measurement, and the memory request
comes down from rusty-llm's 20Gi. Drop these overrides once a GHCR PAT from UiT
is available; the deploy path itself is unchanged.

### 3. inServ (:3021)

```bash
cd telenor/repo/inServ/src

GRAPHDB_BASE_URL=http://localhost:7200 \
GRAPHDB_REPOSITORY=<your-intent-repo> \
INFRASTRUCTURE_GRAPH=http://intendproject.eu/telenor/infra \
INSUSTAIN_BASE_URL=http://localhost:30089/tmf-api/intentManagement/v5 \
INSERV_INSUSTAIN_READY=true \
INSERV_INNET_READY=false \
../.venv/bin/python -m inserv
```

```bash
curl -s localhost:3021/healthz    # note: /healthz, NOT /health
```

Env reference (`inServ/src/inserv/config.py`):

| Var | Value here | Why |
|---|---|---|
| `GRAPHDB_BASE_URL` | `http://localhost:7200` | default is UiT, unreachable |
| `GRAPHDB_REPOSITORY` | your own intent repository | shared for infra lookup **and** intent storage — hence the triple in step 1 |
| `INFRASTRUCTURE_GRAPH` | `http://intendproject.eu/telenor/infra` | matches the graph the triple went into (this is already the default) |
| `INSUSTAIN_BASE_URL` | `http://localhost:30089/tmf-api/intentManagement/v5` | inServ appends `/intent` |
| `INSERV_INSUSTAIN_READY` | `true` | when `false`, inServ only *stores* the intent in GraphDB instead of forwarding |
| `INSERV_INNET_READY` | `false` | no inNet locally; the test intent has no NE anyway |

---

## Fire the chain

The working intent is **`test-intent-de-se.ttl`** in this directory: DE with
`data5g:DataCenter "EC_31"` + `DeploymentDescriptor "urn:helm:rusty-llm:0.1.26"`,
SE with `powerConsumption < 300 W` and `energyConsumption < 100000000 J`, plus
two reporting expectations.

```bash
cd telenor/repo/mock-inorch

python3 - <<'PY' > /tmp/intent.json
import json
ttl = open("test-intent-de-se.ttl").read()
json.dump({
    "@type": "Intent",
    "name": "Local DE+SE test",
    "expression": {
        "@type": "TurtleExpression",
        "iri": "http://5g4data.eu/5g4data#Ilocaltest01",
        "expressionValue": ttl,
    },
}, open("/dev/stdout", "w"))
PY

curl -sS -X POST http://localhost:3021/tmf-api/intentManagement/v5/intent \
  -H 'Content-Type: application/json' -d @/tmp/intent.json | jq
```

The payload shape is not optional — inServ's OAS (`Intent_FVO` →
`TurtleExpression_FVO`) requires **`@type`**, **`name`**, and
**`expression.iri`** alongside `expressionValue`. Omitting any of them yields an
opaque `400`.

Expect in the inServ log:

```
Parsing: Detected expectations: DE, SE
Routing: Sending full intent (with SE) to inSustain at http://localhost:30089/tmf-api/intentManagement/v5/intent
Lookup: Found EC_31 endpoint in inGraph: http://localhost:3020/tmf-api/intentManagement/v5/
```

and `201` from both mock-inorch and InSustain.

---

## Verify

### Deployment leg

```bash
kubectl --context inHouse -n rusty-llm get pods
helm --kube-context inHouse -n rusty-llm list
```

The namespace comes from `data5g:Application` in the intent's Context node,
lower-cased with `_`→`-` (mock-inorch `app.py`), hence `rusty-llm`.

### Monitoring leg

```bash
BASE=http://localhost:30089

# backend can see the cluster? (this is the RBAC check)
curl -s $BASE/health | jq '.permissions'          # can_list_pods must be true

# the SE auto-registered the workload
curl -s $BASE/application | jq '.[] | {name, namespace, k8s_labels}'
# → { "name": "rusty-llm", "namespace": "rusty-llm",
#     "k8s_labels": { "app.kubernetes.io/name": "rusty-llm" } }

INTENT=$(curl -s $BASE/tmf-api/intentManagement/v5/intent | jq -r '.[-1].id')

# generate a report (queries Kepler for real)
curl -sS -X POST $BASE/tmf-api/intentManagement/v5/intent/$INTENT/intentReport | jq

curl -s $BASE/tmf-api/intentManagement/v5/intent/$INTENT/intentReport \
  | jq '.[-1] | {target, measurements}'
```

### Put load on it first

An idle nginx legitimately reports **0.0 W** — that is not a bug, and a 0-watt
report proves nothing. Generate load before trusting the numbers:

```bash
POD=$(kubectl --context inHouse -n rusty-llm get pod -o name | head -1)
kubectl --context inHouse -n rusty-llm exec $POD -- \
  sh -c 'for i in 1 2 3 4; do (while :; do :; done) & done; sleep 120; kill %1 %2 %3 %4'
```

then re-trigger the report.

### Straight from Prometheus

```bash
curl -sG http://localhost:30900/api/v1/query \
  --data-urlencode 'query=sum(rate(kepler_pod_cpu_joules_total{pod_name="'"${POD#pod/}"'"}[2m]))' | jq
```

The label is **`pod_name`**, not `pod` (`pod` is the *kepler* daemonset pod), and
the metric has one series per RAPL zone (core/dram/package) that must be summed.
Prometheus is on the host at `:30900` (NodePort), not 9090. Don't use the
`kepler_pod_cpu_watts` gauge — it reads 0 even under load.

---

## Gotchas

- **RBAC is off unless you ask for it.** `scripts/setup-insustain-k8s-native.sh`
  overrides the chart default to `backend.rbac.create=false` unless
  `--enable-full-rbac` is passed. Without it the backend ServiceAccount cannot
  list pods, `discover_pods_by_labels` raises, the exception is swallowed, and
  reports come back with **null measurements and no error**. Check
  `/health → permissions.can_list_pods` first, always. A redeploy also restarts
  the backend and kills the port-forward.
- **Report says 0.0 W** → idle workload, not a defect. See load generation above.
- **rusty-llm image is private** → 403. Public-image substitution is in step 2.
- **`docker network … does not exist`** after a host reboot (stale libnetwork
  state): `docker network rm mlflow-network && docker network prune -f && docker network create mlflow-network`, then `docker compose up -d`. A plain
  `down`/`up` does not clear it.
- **Don't `pkill -f app.py`** in this repo — it matches unrelated tooling. Kill
  by port: `ss -tlnpH 'sport = :3020' | grep -oP 'pid=\K[0-9]+'`.
- **`GRAPHDB_URL` is not set on the InSustain backend**, and the backend
  chart's deployment template has no env entry for it. So the report's
  `met:Observation` Turtle is generated and returned, but never pushed to
  GraphDB. IntentDashboard integration needs that wired up first.

## inServ SE routing lives on `feature/insustain-routing`

Not on `main`. The relevant files are `inServ/src/inserv/`: `config.py`,
`__init__.py`, `services/turtle_parser.py`, `services/intent_router.py`,
`controllers/intent_controller.py`.

What they add: `find_sustainability_expectation()`; `find_all_expectations()`
returning `(ne, de, se, re_list)`; `_route_to_insustain()`; the
`insustain_base_url` / `insustain_ready` config; and a controller that no longer
demands a `DataCenter` when an SE is present (so SE-only intents are accepted —
though an SE-only intent monitors and deploys nothing, a DE is what triggers the
deploy).

## Still open

- **Wire `GRAPHDB_URL` on the InSustain backend** (needs an env entry in
  `insustain/charts/backend/templates/deployment.yaml` + a redeploy) so energy
  observations reach GraphDB and IntentDashboard.
- **GHCR PAT from UiT** to run the real rusty-llm LLM instead of the nginx stand-in.
  For reference, the real workload is CPU-only, weights baked into the image,
  needs a `ghcr-secret` imagePullSecret, and exposes an OpenAI API on `:8080`,
  Prometheus on `:8081`, and Open WebUI on NodePort `30873`.
- **Old non-conformant intents** may accumulate in the intent repository from
  earlier runs. Drop them if a clean report listing matters.
- The `intent_handler.py` fixes live in the `iintend-uc3` repo (InSustain) and are
  tracked separately from this one.

## What the mock deliberately skips

Real inOrch also does per-DataCenter GraphDB chart lookup, ChartMuseum download
with in-cluster host rewrite, image-pull-secret copying, and INTEND
`Intent`/`KPIProfile` CR injection. None of that is needed to measure a pod's
energy, so mock-inorch installs the local
`Workload-Catalog/charts/rusty-llm-0.1.26.tgz` directly. Config knobs are in
`README.md`.
