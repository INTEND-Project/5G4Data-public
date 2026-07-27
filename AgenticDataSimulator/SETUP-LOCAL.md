# Local bring-up (no UiT / start5g-1 access)

How to run the AgenticDataSimulator entirely on one machine, with local Docker stacks
for every dependency and a local LLM proxy in place of a partner-hosted model endpoint.

The committed defaults reference `https://start5g-1.cs.uit.no`, which is only reachable
from inside the Telenor/UiT environment. This guide is for **everyone else**: it lists the
local substitute for each such URL so the simulator can be brought up without any
partner-internal service. Verified working end-to-end for intent generation and
observation generation.

Ports used: LiteLLM `4000`, GraphDB `7200`, Workload-Catalog `3040`
(ChartMuseum `8080`), A2A registry `17001` (UI `17173`), agents `3011`/`3012`, Controller `3000`.

All containers share one user-defined network, **`mlflow-network`**, and reach each
other **by container name** via Docker's built-in DNS (e.g. the agents call
`http://graphdb:7200`, `http://litellm-bedrock:4000`). The Controller runs on the
**host** and reaches the agents at `127.0.0.1:3011/3012` (their published ports).
See "Network topology" below.

> `host.docker.internal` is deliberately **not** used. That path leaves the container,
> hits a published host port and comes back, so it depends on the host firewall allowing
> Docker-bridge traffic to published ports — which it does not on every machine.
> Container-name DNS avoids the host entirely.

---

## Components

| # | Component | Required? | Notes |
|---|-----------|-----------|-------|
| 1 | **LLM endpoint** — e.g. `LiteLLM/` → AWS Bedrock | Yes | Any OpenAI-compatible endpoint works; the bundled example proxies to Bedrock with model `claude-opus-4-8`. On `mlflow-network` + its own bridge (needs internet egress). Reached by agents as `litellm-bedrock:4000`. |
| 2 | **GraphDB** (`GraphDB/`) | Yes | Image **11.4.2** + your own license file. Repos `intents_and_intent_reports` + `telenor-infrastructure-5g4data`; load the infra KG with `./load-infra.sh` (40 edge clusters). Reached as `graphdb:7200`. |
| 3 | **Workload-Catalog** (`../Workload-Catalog/`) | Deployment intents only | ChartMuseum ships **empty** — package and push charts yourself, see "Packaging charts" below. Reached as `workload-catalog-workloads-1:3000`. |
| 4 | **SimulatorAgentKernel/.env** | Yes | Service URLs use container names (`litellm-bedrock`, `graphdb`, `workload-catalog-workloads-1`, `a2a-registry-api`). |
| 5 | **A2A registry** (`a2a-registry/`) | Only for A2A discovery | API `a2a-registry-api:8000` (host `:17001`), UI `:17173`. Needs `.env`; PostHog can stay disabled. |
| 6 | **Agents** (`./agent-control start`) | Yes | intent-gen `:3011`, observation-gen `:3012`. MLflow tracing is off by default — no MLflow stack ships with the simulator. |
| 7 | **SimulatorController** (`SimulatorController/`) | For the web UI | Runs on the host → reaches agents at `127.0.0.1:3011/3012`. |
| 8 | Prometheus / Grafana | Optional | Only for observation-in-Prometheus storage + dashboards. |

---

## Secrets (all gitignored — recreate in a fresh clone)

- `LiteLLM/.env` — `LITELLM_MASTER_KEY` (generate: `openssl rand -hex 32`), `AWS_PROFILE`, `AWS_REGION`. Start from `LiteLLM/.env.example`.
- `GraphDB/*.license` — a GraphDB 11.x license (binary, ~768 B) obtained for your own organisation. See `GraphDB/README.md`.
- `SimulatorAgentKernel/.env` — `OPENAI_API_KEY` **must equal** `LITELLM_MASTER_KEY` (the proxy authenticates every request with it).

If you use the Bedrock example, refresh SSO before starting LiteLLM and on any day the
token has expired: `aws sso login --profile "$AWS_PROFILE"`. LiteLLM reads `~/.aws`
(mounted read-only) and picks up refreshed tokens with no restart.

---

## Cold-start order

```bash
cd AgenticDataSimulator

# 0a. Shared Docker network (once per machine; every stack attaches to it)
docker network create mlflow-network 2>/dev/null || true
#   NB: `docker network prune` deletes it when no container is attached — recreate
#   before bringing stacks up if you have pruned.

# 0b. Refresh LLM credentials. For the Bedrock example, that is SSO (daily):
aws sso login --profile "$AWS_PROFILE"

# 1. LLM endpoint (bundled example: LiteLLM → Bedrock)
cd LiteLLM && docker compose up -d && cd ..
curl -sf http://127.0.0.1:4000/health/liveliness && echo " LiteLLM OK"
# smoke test (key from LiteLLM/.env):
#   curl -sX POST http://127.0.0.1:4000/v1/chat/completions \
#     -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H "Content-Type: application/json" \
#     -d '{"model":"claude-opus-4-8","messages":[{"role":"user","content":"ping"}]}'

# 2. GraphDB (needs GraphDB/graphdb.license in place first — see GraphDB/README.md;
#    repos persist in the graphdb-data volume across restarts)
cd GraphDB && docker compose up -d && cd ..
curl -sf http://localhost:7200/rest/repositories && echo " GraphDB OK"
# First run, or if the volume was wiped: create the two repos in the Workbench
# (http://localhost:7200 → Setup → Repositories), then:
#   cd GraphDB && ./load-infra.sh   # loads 40 edge clusters, prints count

# 3. Workload-Catalog  (only needed for deployment/workload-aware intents)
cd ../Workload-Catalog && docker compose up -d && cd ../AgenticDataSimulator
curl -sf http://localhost:3040/index.yaml | head
#   ^ entries: {} means no charts yet — see "Packaging charts" below.

# 4. A2A registry
cd a2a-registry && docker compose up -d && cd ..
curl -sf http://127.0.0.1:17001/health && echo " registry OK"

# 5. Agents  (after registry)
./agent-control start
curl -sf http://127.0.0.1:3011/health   # intent generation
curl -sf http://127.0.0.1:3012/health   # observations

# 6. Controller  (after agents; create SimulatorController/.env, sweep UiT URLs)
# cd SimulatorController && npm install
# npx prisma db push          # DATABASE_URL must be set in .env
# npm run build && npm run start
# open http://localhost:3000/tmf-simulator
```

---

## Network topology

One user-defined bridge network, **`mlflow-network`**, connects everything; containers
resolve each other by name through Docker's embedded DNS. Each service also keeps its own
compose `default` bridge (its own DB, internet egress, etc.).

```
        HOST (laptop)
        ├─ SimulatorController ─┐   ./agent-control health check ─┐
        │                       │ 127.0.0.1:3011 / :3012           │ (published agent ports)
   ┌────┼───────────────────────▼──────────────────────────────────▼──── Docker: mlflow-network ─┐
   │    │                    ┌──────────────┐   by container name    ┌──────────────┐             │
   │    └─ browser ──► :7200 │ intent-gen   │ ─────────────────────► │  graphdb     │             │
   │       :17001 :3040      │  :3011       │   graphdb:7200          │  litellm-... │             │
   │                         │ observation  │   litellm-bedrock:4000  │  workload-.. │             │
   │                         │  :3012       │   ...-workloads:3000    │  a2a-reg-api │             │
   │                         └──────────────┘   a2a-registry-api:8000 └──────┬───────┘             │
   └───────────────────────────────────────────────────────────────────────┼─────────────────────┘
                                                                             │ litellm own bridge → AWS Bedrock
                                                                             ▼
```

- **Agent → service:** container name on `mlflow-network` (no host hop, no firewall dependency).
- **Host (Controller / health) → agent:** agent's published port on `127.0.0.1`.
- **LLM proxy → provider:** its own compose bridge provides internet egress; the agents do not need it.

## UiT → local URL rewrites (apply everywhere)

No `start5g-1.cs.uit.no` URL resolves outside the partner environment, so repoint each as
you reach that component. Container→container URLs use the **service's container name**
(from `docker ps`):

| Setting | Committed default (UiT) | Local value |
|---------|-------------------------|-------------|
| `OPENAI_BASE_URL` | (n/a) | `http://litellm-bedrock:4000/v1` (agents) |
| `A2A_AGENT_BASE_URL` | `https://start5g-1.cs.uit.no` | the agent's own reachable address, e.g. `http://172.17.0.1:3011` — plus `A2A_DISABLE_PATH_SLUG=true`, see below |
| `GRAPHDB_BASE_URL` / infra endpoint | UiT `/graphdb` | `http://graphdb:7200/` (agents), `http://localhost:7200/` (host Controller) |
| `WORKLOAD_CATALOG_BASE_URL` | `…/wchartmuseum` | `http://workload-catalog-workloads-1:3000` (agents) |
| `A2A_REGISTRY_BASE_URL` | `…/a2a-registry` | `http://a2a-registry-api:8000` (agents) |
| `MLFLOW_TRACKING_URI` / `MLFLOW_TRACING_ENABLED` | `http://mlflow:5000/mlflow`, `true` | blank / `false` — no MLflow stack ships with the simulator |
| Prometheus / Pushgateway | `…/prometheus*` | `http://127.0.0.1:9090/prometheus`, `:9091` (only if using Prometheus storage) |
| Grafana | `…/grafana` | local Grafana (only for dashboards) |

The UiT deployment fronts each agent with a reverse proxy that routes by a path slug
(`https://start5g-1.cs.uit.no/<agent-name>`). Locally the agents are addressed directly on
their own ports, so there is no slug to route on. Set **`A2A_DISABLE_PATH_SLUG=true`** to
have the kernel publish `A2A_AGENT_BASE_URL` verbatim in its agent card instead of
appending the agent name — otherwise the registry fetches
`http://172.17.0.1:3011/5g4data-intent-generating-agent/...` and gets a 404.

`ONTOLOGY_ROOT` / `EXAMPLE_INTENTS_ROOT` are left blank: no local TMForum ontology
checkout (`IntentCommonModel.ttl`) exists, and the ontology tool degrades gracefully.
SHACL validation still runs via the bundled `skill_subset_intent_shapes.ttl`.

---

## Packaging Workload-Catalog charts (ChartMuseum index is empty)

The catalog serves packaged `.tgz` charts, but ships only chart *source*
(`../../Workload-Catalog/workloads/*/helm/*`). Package and push each once so the
agent's `index.yaml` fetch returns entries:

```bash
cd ../Workload-Catalog
helm package workloads/ai-server/helm/rusty-llm -d /tmp/charts
# push to ChartMuseum (:8080 is the chartmuseum service host port)
curl -s --data-binary @/tmp/charts/<packaged>.tgz http://localhost:8080/api/charts
curl -s http://localhost:3040/index.yaml   # verify entries populated
```

Only needed for deployment/workload-aware intents.

---

## Notes / gotchas

- **GraphDB image must be 11.4.x+**, not 11.0/11.1 — a license issued for the "any 11.x
  version" range is rejected by the validator in those older builds.
- **`docker compose up -d --force-recreate`** after editing an `.env` — a plain
  `restart` does not re-read env. Editing a *bind-mounted* file (e.g. `config.yaml`,
  `graphdb.license`) only needs `restart`.
- **Stale docker network** (`network … does not exist`, typically after a host reboot):
  `docker compose down && docker network rm mlflow-network; docker network prune -f && docker network create mlflow-network`,
  then `docker compose up -d`. A plain `down`/`up` does not clear the stale libnetwork state.
- `AGENT_API_KEY` in the kernel `.env` stays blank — keys are generated on
  `package load` and synced into `SimulatorController/.env` and `a2a-registry/.env`
  as `AGENT_API_KEYS`. The A2A registry authenticates its card fetch and conformance
  smoke test with `AGENT_API_KEY`; with slug-less local URLs it cannot name-match an
  agent, so set that single shared value in `a2a-registry/.env` as the global fallback.
- **A2A registry restart loop**: the registry's `api` service runs with `API_RELOAD=false`
  locally. `agent-control` writes generated `AGENT_API_KEYS` into the bind-mounted
  `backend/.env`, which the reloader watches — with reload on, that is an endless
  restart cycle.
- **The agent clones under `agents/` are gitignored.** They are generated by
  `./agent-control` from `SimulatorAgentPackages/` + `SimulatorAgentKernel/` and hold
  per-clone `.env` API keys. Re-run `./agent-control reload` in a fresh clone rather than
  expecting them to be present.
