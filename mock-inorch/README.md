# mock-inorch

A minimal stand-in for `inOrch-TMF-Proxy` for **local** rusty-llm energy studies.

It exposes the same endpoint inServ routes a `DeploymentExpectation` to
(`POST /tmf-api/intentManagement/v5/intent`), parses the Helm chart URL +
application name out of the intent Turtle, and deploys the workload with a plain
`helm upgrade --install`. InSustain (via Kepler) then measures the pod's energy.

## Why this exists

Real inOrch does a lot we don't need locally: GraphDB per-DataCenter domain
lookup, ChartMuseum download + in-cluster host rewrite, image-pull-secret
copying, and INTEND `Intent`/`KPIProfile` CR injection. This mock skips all of
it and just installs the **local** chart, so the flow is:

```
intent → inServ → DeploymentExpectation → mock-inorch  (helm install rusty-llm)
               → SustainabilityExpectation → inSustain  (Kepler energy analysis)
```

inServ routing is unchanged — we simply register `EC_31`'s `aeros:domain` to
point at this service instead of the real inOrch.

## Run

```bash
cd mock-inorch
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python app.py                      # serves on 0.0.0.0:3020
curl -s localhost:3020/health | jq
```

`helm` and a working `kubectl` context must be on PATH (this deploys to your
**current** kube context unless `MOCK_INORCH_KUBE_CONTEXT` is set).

The default chart path (`../Workload-Catalog/charts/rusty-llm-0.1.26.tgz`) is a
**packaged** chart and is not committed. Either package it yourself —
`helm package ../Workload-Catalog/workloads/ai-server/helm/rusty-llm -d ../Workload-Catalog/charts`
— or point `MOCK_INORCH_CHART` at any local chart you want to measure. The mock does not
care which chart it installs.

### Config (env)

| Var | Default | Purpose |
|-----|---------|---------|
| `MOCK_INORCH_PORT` | `3020` | listen port |
| `MOCK_INORCH_CHART` | `../Workload-Catalog/charts/rusty-llm-0.1.26.tgz` | chart to install |
| `MOCK_INORCH_RELEASE` | `rusty-llm` | helm release name |
| `MOCK_INORCH_NAMESPACE` | *(app name from intent)* | pin the target namespace |
| `MOCK_INORCH_KUBE_CONTEXT` | *(current)* | `--kube-context` for helm |
| `MOCK_INORCH_HELM_SET` | `intent.enabled=false,kpiProfile.enabled=false` | disables INTEND CRs (no CRDs on cluster) |
| `MOCK_INORCH_HELM_WAIT` | `false` | add `--wait` (blocks until pods ready; image pull can be slow) |

## Cluster prerequisite: image pull secret

The rusty-llm chart references `imagePullSecrets: [ghcr-secret]`. Create it in the
namespace the mock will deploy to (namespace = the intent's `data5g:Application`,
lower-cased, `_`→`-`; e.g. `rusty-llm`). If the GHCR image is public a dummy
secret still satisfies the reference:

```bash
kubectl create namespace rusty-llm
kubectl -n rusty-llm create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=x --docker-password=x
```

(For a private image use a real GHCR PAT as the password.)

## Wire inServ → mock-inorch

inServ resolves the inOrch target by SPARQL:
`spo:<DC> aeros:domain ?domain` in graph `<http://intendproject.eu/telenor/infra>`
of its configured repository, where `spo: <https://intendproject.eu/telenor/>`.

Two things must line up:

1. **The triple must live in the repository inServ actually queries.** inServ
   shares **one** `GraphDbClient` between infrastructure lookup and intent
   storage, so `GRAPHDB_REPOSITORY` is used for both. Insert the triple into that
   repository — the one holding intents — **not** into
   `telenor-infrastructure-5g4data`. Repointing `GRAPHDB_REPOSITORY` at the infra
   repo breaks intent persistence, and the synthetic infra data carries no
   `aeros:domain` triple anyway.

2. **`EC_31` needs an `aeros:domain` triple** pointing at the mock. The subject
   namespace inServ expects is `https://intendproject.eu/telenor/` — *not* the
   `.../schema/` namespace the synthetic data uses. Use the mock's host as
   reachable from the inServ process (`localhost:3020` when inServ runs on the
   host; `172.17.0.1:3020` when it runs in a container):

   ```bash
   curl -X POST \
     -H 'Content-Type: application/sparql-update' \
     --data-urlencode 'update=
       PREFIX spo:   <https://intendproject.eu/telenor/>
       PREFIX aeros: <https://aeros.eu/schema/>
       INSERT DATA {
         GRAPH <http://intendproject.eu/telenor/infra> {
           spo:EC_31 aeros:domain "localhost:3020" .
         }
       }' \
     http://localhost:7200/repositories/<your-intent-repo>/statements
   ```

   A bare `host:port` literal is wrapped by inServ into
   `http://localhost:3020/tmf-api/intentManagement/v5/`; a value starting with
   `http(s)://` is used as-is. Either way `/intent` is appended, giving
   `http://localhost:3020/tmf-api/intentManagement/v5/intent`.

3. **Point inServ at InSustain** (the SE leg) and mark it ready:
   ```bash
   export INSUSTAIN_BASE_URL=http://<insustain-host>/tmf-api/intentManagement/v5
   export INSERV_INSUSTAIN_READY=true
   ```

## End-to-end

**See [`RUNBOOK.md`](RUNBOOK.md)** for the verified cold-start procedure: exact env for
both legs, the working test intent (`test-intent-de-se.ttl`), the verification curls, and
the gotchas that produce silent wrong results. In outline:

1. Insert the `aeros:domain` triple (above).
2. Start `mock-inorch` (this service).
3. Start inServ (`python -m inserv`, port 3021).
4. Ensure `ghcr-secret` exists in the target namespace (see above).
5. POST a **DE + SE** intent to inServ. It routes the DE to mock-inorch
   (→ helm install) and the SE to InSustain (→ energy monitoring). An SE-only
   intent monitors but deploys nothing; a DE is what triggers the deploy.
   The payload requires `@type`, `name` and `expression.iri` alongside
   `expressionValue` — omitting any of them yields an opaque `400`.
6. Verify: `kubectl -n rusty-llm get pods`, then trigger an InSustain intent
   report and check the measurements.
