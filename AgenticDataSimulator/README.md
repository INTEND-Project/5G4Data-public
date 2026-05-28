# AgenticDataSimulator

Multi-agent data generation simulator stack for the 5G4Data project.

## Components

| Directory | Role |
|-----------|------|
| `SimulatorAgentKernel` | Generic runtime kernel; loads domain packages and creates package-bound agent clones |
| `SimulatorAgentPackages` | Domain package registry (intent generation, observations, templates) |
| `SimulatorController` | Web workspace for script authoring, agent discovery, and execution |
| `Grafana` | Grafana dashboard exports for the simulator (avalanche demo) |
| `a2a-registry` | Agent-to-agent registry for discovery and registration |

See also [`README-a2a-registry.md`](README-a2a-registry.md) for deployment and Caddy/UFW integration notes.

## External dependencies and startup order

The simulator **agents** and **controller** rely on several other services. Start dependencies **before** `./agent-control start` and before [SimulatorController](#simulatorcontroller). On **start5g-1**, many of these run as shared lab infrastructure behind Caddy; locally you start only what you need.

### Dependency overview

| Dependency | Used by | Required for | Typical URL (start5g-1) | Local / self-hosted |
|------------|---------|--------------|-------------------------|---------------------|
| **GraphDB** | Intent agent, observation agent, controller (KG targets), Grafana (SPARQL), metadata | Always (intents + observation metadata) | `https://start5g-1.cs.uit.no/graphdb/` (`:7200`) | Point agent/controller `.env` at your instance |
| **Workload catalogue** (Helm Chart Museum) | Intent generation agent | Deployment / workload-aware intents | `https://start5g-1.cs.uit.no/wchartmuseum` | Set `WORKLOAD_CATALOG_BASE_URL` in agent `.env` |
| **TM Forum intent ontology** (files) | Intent generation agent | SHACL validation, prompt context | `ONTOLOGY_ROOT` in agent clone `.env` | Set path to your local `TMForumIntentOntology` checkout |
| **A2A registry** | Agents (register on startup), controller (discover agents) | Controller script `discover …` lines | `https://start5g-1.cs.uit.no/a2a-registry` | [`a2a-registry/`](a2a-registry/) — `docker compose up -d` (`:17001` API) |
| **Caddy reverse proxy** | Public HTTPS for agents, GraphDB, registry, Prometheus | start5g-1 deployment only | See [Infrastructure on start5g-1](#infrastructure-on-start5g-1-caddy) | Optional locally (use direct ports instead) |
| **Prometheus + Pushgateway** | Observation agent (`storage prometheus`) | Prometheus observation storage only | `…/prometheus`, `…/prometheus-pushgateway` | [`Prometheus/`](Prometheus/) — `./start.sh` (`:9090`, `:9091`) |
| **IntentReportQueryProxy** | Grafana timeseries panels (Infinity datasource) | Viewing metrics in Grafana only | `http://start5g-1.cs.uit.no:3010` | [`./IntentReportQueryProxy/`](./IntentReportQueryProxy/) — `docker compose up -d` |
| **Grafana** (+ SPARQL & Infinity plugins) | Dashboards in [`Grafana/`](Grafana/) | Visualization only | `http://start5g-1.cs.uit.no:3002` (example) | See [`Grafana/`](Grafana/) and [`../IntentDashboard/src/START-GRAFANA.md`](../IntentDashboard/src/START-GRAFANA.md) |
| **LLM provider** (OpenAI / Anthropic) | Both agents | Running agent turns | API keys in agent clone `.env` | — |

**Not started by this repo:** GraphDB, workload catalogue, Caddy, and Grafana are usually operated separately on the lab host. This repository provides `./agent-control`, `Prometheus/`, `a2a-registry/`, and the controller app.

### Recommended startup order

```text
1. GraphDB                          (or confirm shared instance is up)
2. Workload catalogue               (if generating deployment intents)
3. A2A registry                     (if not using shared start5g-1 registry)
4. Prometheus + Pushgateway       (only if using storage prometheus)
5. IntentReportQueryProxy           (only if using Grafana timeseries dashboards)
6. Grafana                          (only for dashboards)
7. Simulator agents                 ./agent-control start
8. SimulatorController              cd SimulatorController && npm run build && npm run start
                                    (or `npm run dev` for development with hot reload)
```

After **re-cloning agents** (`package load`), restart the controller so it loads fresh `AGENT_API_KEYS` from `SimulatorController/.env`.

### Start commands and health checks

**GraphDB** — confirm SPARQL responds (repository name varies by deployment):

```bash
curl -sf "https://start5g-1.cs.uit.no/graphdb/repositories/intents_and_intent_reports/size"
```

**Workload catalogue** — intent agent calls `WORKLOAD_CATALOG_BASE_URL` (default Chart Museum on start5g-1):

```bash
curl -sf "https://start5g-1.cs.uit.no/wchartmuseum/index.yaml" | head
```

**A2A registry** (local):

```bash
cd a2a-registry
docker compose up -d
curl -sf http://127.0.0.1:17001/health
```

See [`README-a2a-registry.md`](README-a2a-registry.md) for Caddy paths, UFW rules, and agent registration.

**Prometheus + Pushgateway** (local):

```bash
cd Prometheus
./start.sh
curl -sf http://127.0.0.1:9090/prometheus/-/healthy
curl -sf http://127.0.0.1:9091/metrics | head
```

**IntentReportQueryProxy** (for Grafana metric panels):

```bash
cd IntentReportQueryProxy
docker compose up -d --build
curl -sf http://127.0.0.1:3010/health
```

The proxy reads metric query URLs from GraphDB (`http://intent-reports-metadata`) and forwards range queries to Prometheus or GraphDB. Restart it after code changes: `docker compose up -d --build`.

**Grafana** — install SPARQL and Infinity datasource plugins, then import the **simulator dashboards from [`Grafana/`](Grafana/)** (these are the ones to use with this stack; older exports under [`../IntentDashboard/src/`](../IntentDashboard/src/) are superseded for the avalanche demo):

| File | Purpose |
|------|---------|
| [`Grafana/SimulatorIntentDashboard.json`](Grafana/SimulatorIntentDashboard.json) | Intent overview (stats, intent list, drill-down links) |
| [`Grafana/SimulatorIntentAndConditionMetricsTimeseriesDashboard.json`](Grafana/SimulatorIntentAndConditionMetricsTimeseriesDashboard.json) | Per-intent condition metric timeseries (opened from overview or the controller Grafana icon) |

Import both JSON files into Grafana. Setup steps (plugins, datasources): [`../IntentDashboard/src/START-GRAFANA.md`](../IntentDashboard/src/START-GRAFANA.md). The controller Grafana icon uses `GRAFANA_TIMESERIES_DASHBOARD_UID=Simulator-5g4data-Metrics` (see `SimulatorController/.env.example`). Timeseries panels call IntentReportQueryProxy with `repository_id=${repository_id}` from the dashboard URL (same KG target as SPARQL panels). Re-import dashboards after JSON changes (`./Grafana/import-dashboards.sh`). Restart the proxy after updates (`cd IntentReportQueryProxy && docker compose up -d --build`).

**Simulator agents:**

```bash
./agent-control start
curl -sf http://127.0.0.1:3011/health
curl -sf http://127.0.0.1:3012/health
```

### SimulatorController

Copy and edit `.env` from `.env.example` before the first run (`APP_BASE_PATH`, GraphDB/registry URLs, `AGENT_API_KEYS`, etc.).

**Production (recommended)** — faster and more responsive, especially when using the UI from a remote browser:

```bash
cd SimulatorController
npm install          # first time only
npm run build
npm run start
```

To accept connections from other hosts (e.g. start5g-1 behind a reverse proxy), bind on all interfaces:

```bash
npm run build
npx next start -H 0.0.0.0 -p 3000
```

Re-run `npm run build` after controller code changes, then restart `npm run start`.

**Development** — hot reload while editing the controller; can feel sluggish over high-latency remote links:

```bash
cd SimulatorController
npm install          # first time only
npm run dev
```

Open `http://localhost:3000/tmf-simulator` (see `APP_BASE_PATH` in `SimulatorController/.env`).

### Minimal stacks

| Goal | Start before agents |
|------|---------------------|
| Controller script, GraphDB storage only | GraphDB, A2A registry |
| + Prometheus observation storage | Above + Prometheus/Pushgateway; set observation clone `PUSHGATEWAY_URL` / `PROMETHEUS_URL` |
| + Grafana dashboards | Above + IntentReportQueryProxy + Grafana (+ re-run observations so metadata is fresh) |
| Full start5g-1 lab | Shared GraphDB, catalogue, Caddy, registry; local Prometheus/Grafana/proxy as needed |

## Typical workflow

1. Start [external dependencies](#external-dependencies-and-startup-order) required for your scenario.
2. Author or extend a package under `SimulatorAgentPackages/`.
3. Start both simulator agents (from this directory):

   ```bash
   ./agent-control start
   ```

   Other commands: `./agent-control stop`, `./agent-control restart`, `./agent-control --help`

   To run `agent-control` without `./`, add `bin` to your `PATH` once per shell (or add to `~/.bashrc`):

   ```bash
   cd AgenticDataSimulator
   export PATH="$(pwd)/bin:$PATH"
   agent-control start
   ```
## Agent logs on the host

Each running agent container bind-mounts its log directory to the corresponding clone directory on the host:

| Agent | Host log directory |
|-------|-------------------|
| Intent generation | `SimulatorAgentKernel-5g4data-intent-generating-agent/logs/` |
| Observations | `SimulatorAgentKernel-5g4data-intent-observation-generating-agent/logs/` |

Agents are started with `--debug`, so you will typically see files such as `openclaw-agent-debug.jsonl` there (and additional observation logs under the observations agent clone).

To **stop** writing logs to the host filesystem, remove the bind mount from that agent's `docker-compose.yml`:

```yaml
    volumes:
      - ./logs:/app/logs
```

Then recreate the container (for example `./agent-control restart` or `docker compose up -d --force-recreate` in the clone directory). Logs will remain inside the container only unless you also remove `--debug` from the `command` in the same file.

## Authentication

Cloned agents enforce **API key authentication** on HTTP/A2A endpoints (A2A v0.3 `securitySchemes`). Keys are generated on `package load` and synced into `SimulatorController/.env` and `a2a-registry/backend/.env` as `AGENT_API_KEYS`. See [`SimulatorAgentKernel/README.md`](SimulatorAgentKernel/README.md#authentication) for details.

Some shared assets remain under `IntentAgent/` (for example `HermesAgent/`). The kernel system prompt lives at `SimulatorAgentKernel/SYSTEM_PROMPT.md`.

## Observation storage (GraphDB vs Prometheus)

Controller scripts run **`create intent …` before `request observation-report …`** for the same intent alias. Storage is selected on the DSL line and reflected in generated intent Turtle (`icm:reportDestinations`) and in the observation agent runtime.

### DSL

```text
create intent using intentGen storage graphdb prompt "…" as myIntent
create intent using intentGen storage prometheus prompt "…" as myIntent
request observation-report using observationControl for myIntent instructions "…" as obsSession
request observation-report using observationControl for myIntent storage prometheus instructions "…" as obsSession
```

- Omitted `storage` on `create intent` defaults to **`graphdb`**.
- Omitted `storage` on `request observation-report` means no session override (use intent Turtle + create-intent choice).

**Resolution order** for observation datapoints: `request observation-report … storage` override → `icm:reportDestinations` in intent Turtle → `create intent … storage` alias map → default `graphdb`.

**Metadata** (how to query stored metrics) is always registered in the GraphDB metadata graph `http://intent-reports-metadata` (GraphDB SPARQL URL for graphdb storage, Prometheus `/api/v1/query` URL for prometheus storage).

### Environment (observation agent clone)

Set in the observation clone `.env` (see `SimulatorAgentPackages/5g4data-intent-observations/mappings/env.defaults.json`):

| Variable | Purpose |
|----------|---------|
| `GRAPHDB_ENDPOINT` | SPARQL endpoint for intents and observation Turtle |
| `GRAPHDB_NAMED_GRAPH` | Named graph for observation reports (e.g. `http://intent-reports`) |
| `PROMETHEUS_URL` | Prometheus API base for GraphDB `hasQuery` metadata (IntentReportQueryProxy reads this URL); use `http://127.0.0.1:9090/prometheus` on start5g-1 |
| `PROMETHEUS_REMOTE_WRITE_URL` | Historic observation batch write endpoint; use `http://host.docker.internal:9090/prometheus/api/v1/write` from Dockerized agent |
| `PUSHGATEWAY_URL` | Pushgateway base for streaming samples; use `http://host.docker.internal:9091` from Dockerized agent |
| `NO_GRAPHDB` | When `true`, skip GraphDB observation inserts (metadata registration still attempted) |

### Start Prometheus and Pushgateway

Prometheus and Pushgateway are **not** started by `./agent-control` or the tutorial `docker compose`. Use the stack under [`Prometheus/`](Prometheus/) (Docker required).

**Start** (from `AgenticDataSimulator`):

```bash
cd Prometheus
./start.sh
```

**Stop:**

```bash
cd Prometheus
./stop.sh
```

TSDB time series persist in **`Prometheus/tsdb/`** across `./stop.sh` and `./start.sh`. To wipe all Prometheus and Pushgateway metrics, run `./delete-data.sh` in `Prometheus/`.

This runs Pushgateway on **9091** and Prometheus on **9090**. Prometheus scrapes Pushgateway using [`Prometheus/prometheus.yml`](Prometheus/prometheus.yml) (pushed intent metrics use job `intent_reports`; internal `pushgateway_*` metrics are dropped). The same config sets `storage.tsdb.out_of_order_time_window: 365d` so historic observation batches can remote-write samples with past `obtainedAt` timestamps.

**On start5g-1** (so the Prometheus UI links work behind Caddy):

```bash
export PROMETHEUS_EXTERNAL_URL=https://start5g-1.cs.uit.no/prometheus
./start.sh
```

Ensure the [Caddy routes](#infrastructure-on-start5g-1-caddy) are active so agents can reach the services over HTTPS. Reload Caddy after `Caddyfile` changes (`docker compose up -d` in `5G4Data-Tutorial/`).

**Observation agent `.env`** (after services are up; `package load` applies defaults from `mappings/env.defaults.json` via `onPackageLoad`):

| Variable | Purpose (start5g-1 Docker agent) |
|----------|----------------------------------|
| `PROMETHEUS_URL` | Metadata/query base for proxy on host: `http://127.0.0.1:9090/prometheus` |
| `PROMETHEUS_REMOTE_WRITE_URL` | Historic batch write: `http://host.docker.internal:9090/prometheus/api/v1/write` |
| `PUSHGATEWAY_URL` | Streaming push: `http://host.docker.internal:9091` |

| Where you run agents | `PROMETHEUS_URL` | `PUSHGATEWAY_URL` |
|----------------------|------------------|-------------------|
| Host (no Docker) | `http://127.0.0.1:9090/prometheus` | `http://127.0.0.1:9091` |
| start5g-1 (via Caddy, public HTTPS) | `https://start5g-1.cs.uit.no/prometheus` | `https://start5g-1.cs.uit.no/prometheus-pushgateway` |

When agents run **inside Docker** on start5g-1, use the table above (metadata on `127.0.0.1`, writes via `host.docker.internal`). The kernel-generated clone `docker-compose.yml` adds `extra_hosts` for `host.docker.internal` automatically on `package load`.

Defaults are in `SimulatorAgentPackages/5g4data-intent-observations/mappings/env.defaults.json`.

**Quick checks:**

```bash
curl -s http://127.0.0.1:9091/metrics | head
curl -sf http://127.0.0.1:9090/prometheus/-/healthy
```

### Infrastructure on start5g-1 (Caddy)

| Service | URL | Backend (host) |
|---------|-----|----------------|
| GraphDB | `https://start5g-1.cs.uit.no/graphdb/` | `:7200` |
| Prometheus | `https://start5g-1.cs.uit.no/prometheus` | `:9090` |
| Pushgateway | `https://start5g-1.cs.uit.no/prometheus-pushgateway` | `:9091` |

Caddy routes are defined in [`5G4Data-Tutorial/Caddyfile`](../5G4Data-Tutorial/Caddyfile).

After code changes, reload observation package tools into the clone: `package load` from `SimulatorAgentKernel` or `./agent-control restart`.

#  Manual load agents
This is an alternative way to start agents manually.

1. From `SimulatorAgentKernel`, run `npx tsx src/index.ts package load ../SimulatorAgentPackages/package-name` (package-name is the name of the package folder, e.g. 5g4data-intent-generation).
2. Install node packages: (e.g. *cd ../clone-name* and *npm install* where clone-name is the resulting clone folder, e.g. SimulatorAgentKernel-5g4data-intent-generating-agent)
2. Run the resulting clone form the clone-folder (e.g.  *npx tsx src/index.ts --debug*).


