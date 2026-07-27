# GraphDB (local, Docker)

Local GraphDB **11.4.2** for the simulator — stores intents, intent reports, and the synthetic infrastructure KG. Replaces the shared start5g-1 instance for local development, so this stack has no dependency on any `start5g-1.cs.uit.no` URL.

## License (required before first start)

`docker-compose.yml` bind-mounts `./graphdb.license` into the container. **The license file is deliberately not in the repo** (`.gitignore`) — obtain one for your own organisation and drop it in as `graphdb.license`. Docker creates an empty *directory* at that path if the file is absent, and the container then fails to start.

The image must be **11.4.x or newer**: a license issued for the "any 11.x version" range is rejected by the validator shipped in 11.0.x/11.1.x builds.

## Start

```bash
# Shared network the simulator agents also attach to (once per machine)
docker network create mlflow-network 2>/dev/null || true

docker compose up -d
# Workbench UI:
open http://localhost:7200
# Health:
curl -sf http://localhost:7200/rest/repositories
```

Data persists in the `graphdb-data` volume across restarts. Agents reach GraphDB by container name as `graphdb:7200` on `mlflow-network`; host tooling uses `localhost:7200`.

## Create the repositories the agents expect

The agent env defaults reference two repositories (see
`SimulatorAgentPackages/5g4data-intent-generating-agent/mappings/env.defaults.json`):

| Repository ID                      | Purpose                                    |
| ---------------------------------- | ------------------------------------------ |
| `intents_and_intent_reports`       | Intents + observation reports (read/write) |
| `telenor-infrastructure-5g4data`   | Synthetic Nordic edge-DC infrastructure KG |

Create both via the Workbench (Setup → Repositories → Create) or the REST API:

```bash
# intents repo
curl -sX POST http://localhost:7200/rest/repositories \
  -H "Content-Type: application/json" \
  -d '{"id":"intents_and_intent_reports","type":"graphdb","title":"Intents and intent reports","params":{}}'

# infrastructure repo
curl -sX POST http://localhost:7200/rest/repositories \
  -H "Content-Type: application/json" \
  -d '{"id":"telenor-infrastructure-5g4data","type":"graphdb","title":"Telenor infra 5G4Data","params":{}}'
```

(GraphDB defaults to the GraphDB SE store type; the above uses built-in defaults. If the REST payload is rejected by this version, create them in the Workbench UI instead — it is the reliable path.)

## Load the infrastructure KG

The infrastructure repository needs the synthetic Nordic edge-DC data before
deployment/locality-aware intents will resolve. Run:

```bash
./load-infra.sh          # prints the edge-cluster count on success (40)
```

It converts `../../Synthetic-Infrastructure-Data-Generation/infrastructure-data/5G4Data_Nordic_Edge_Datacenters.csv`
to Turtle via `csv_to_infra_ttl.py`, then `PUT`s it into the `infra` named graph
(`http://intendproject.eu/telenor/infra`) of `telenor-infrastructure-5g4data`.
`PUT` *replaces* the graph, so re-running is idempotent — no duplicate triples.
The generated `nordic_edge_infra.ttl` is gitignored; regenerate rather than commit it.

Overridable: `GRAPHDB_URL`, `GRAPHDB_INFRA_REPOSITORY_ID`, `GRAPHDB_INFRA_NAMED_GRAPH`.

## Auth

This local setup runs GraphDB with security **disabled** (free-edition default) for
simplicity. The agent/controller `.env` files still accept `GRAPHDB_USERNAME` /
`GRAPHDB_PASSWORD`; leave them blank locally. If you enable GraphDB security later,
set those and re-run `./Grafana/configure-jwt-auth.sh` for Grafana panels
(see main README, "GraphDB security").

## Wire the agents to this instance

The agent env defaults (`SimulatorAgentPackages/*/mappings/env.defaults.json`) point at
`http://graphdb:7200/` — container-name DNS on the shared `mlflow-network`. No change is
needed if you run GraphDB from here and start the agents via `./agent-control`. For the
Controller (runs on the host) use `http://localhost:7200/`.

An earlier revision used `host.docker.internal`, which routes container → host port →
container. That hop depends on the host firewall permitting Docker-bridge traffic to
published ports; container-name DNS avoids the host entirely and is the more portable
default. See `../SETUP-LOCAL.md` for the full topology.
