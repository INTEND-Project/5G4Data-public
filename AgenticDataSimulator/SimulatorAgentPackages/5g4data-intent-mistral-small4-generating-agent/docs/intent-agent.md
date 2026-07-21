# Create intent: Controller and intent agent flow

This guide explains what happens when a Controller script runs a **`create intent …`** line: how the Controller parses the DSL, opens an A2A session with the intent-generating agent, and how that agent turns natural language into TM Forum Turtle.

For coordination-specific behaviour (utility functions, `CoordinationExpectation`), see [`coordination-using-utility-function.md`](coordination-using-utility-function.md).

## Overview

A `create intent` step is the bridge between a portable Controller script and a concrete TM Forum intent stored in the selected knowledge graph target.

| Role | Responsibility |
|------|----------------|
| **Controller** | Parse DSL, resolve agent URI, pause script execution, drive the A2A chat dialog, ingest Turtle into GraphDB, bind DSL alias → canonical intent id |
| **Intent-generating agent** (`5g4data-intent-generation`) | Classify the prompt, assemble runtime context, negotiate with the user if needed, generate validated Turtle, run postprocessors |

The agent does **not** own script binding semantics. The Controller maps the DSL alias (for example `llmIntent`) to the canonical intent id (`I…`) after Turtle is stored.

## DSL syntax

```text
create intent using <agentAlias> [storage graphdb|prometheus] prompt "<natural language>" as <intentAlias>
```

Example:

```text
discover intent-agent by domain telenor.5g4data-mistral-small4 as intentGen

create intent using intentGen storage prometheus prompt "I want to experiment with a small llm in a datacenter near Tromsø/Norway in a sustainable manner" as llmIntent
```

| Field | Meaning |
|-------|---------|
| `agentAlias` | Logical name from an earlier `discover intent-agent … as …` line, or the shortcut `intentGen` (resolved via registry for the workspace domain) |
| `storage` | Where **observation reports** for this intent should go: `graphdb` (default) or `prometheus`. Written into generated Turtle as `icm:reportDestinations` and remembered for later `request observation-report` steps |
| `prompt "…"` | Natural-language requirements (deployment, locality, sustainability, network QoS, coordination phrases, etc.) |
| `intentAlias` | Script-local handle used by later lines (`extract metric-catalog for …`, `request observation-report … for …`) |

If `storage` is omitted, it defaults to **`graphdb`**.

## Prerequisites

Before `create intent` can succeed:

1. **Knowledge graph target** — The Controller runner requires a selected KG target in the sidebar. Without it, Turtle is not ingested and the script logs a warning.
2. **Intent-generating agent reachable** — Either:
   - `discover intent-agent by domain <domain> as <agentAlias>`, or
   - `discover intent-agent for domain as <agentAlias>` (workspace domain), or
   - use `intentGen` as the alias (Controller looks up the intent agent for the selected domain via the A2A registry).
3. **Package loaded** — The `5g4data-intent-generation` domain package must be loaded into a SimulatorAgentKernel clone (`package load` from the kernel). That clone exposes the agent card and A2A `message/send` endpoint.

## End-to-end flow

```text
Controller script                Controller UI                     Intent agent (A2A)
─────────────────                ─────────────                     ────────────────────
create intent …          →       Parse DSL statement
                                 Resolve agentAlias → wellKnownURI
                                 Build seed prompt:
                                   storage hint +
                                   optional reporting interval +
                                   user prompt
                                 Pause script; open dialog  →      POST message/send (seed)
                                                                 Classify prompt → intent flags
                                                                 Build runtime context
                                                                 Select prompt modules
                                                                 LLM turn + repair + SHACL
                                                                 Postprocess Turtle
                                 ← visibleText (review or Turtle)
User confirms ("OK")     →       POST message/send ("OK")  →      Generate final Turtle
                                 Extract Turtle from reply
                                 POST store-intent (KG)     →      (optional agent-side persist)
                                 Register intent id
                                 Bind intentAlias → I…
                                 Close dialog
Script continues         →       extract metric-catalog / observation-report …
```

## Controller execution

### 1. Parse and validate

The DSL parser (`SimulatorController/src/lib/dsl/parser/parse-script.ts`) matches:

```text
create intent using ([^\s]+)(?: storage (graphdb|prometheus))? prompt "([\s\S]+)" as ([^\s]+)
```

On **Run Script**, the runner validates the full script, sorts statements by line number, and clears per-run alias maps (`intentIdByAlias`, `intentStorageByAlias`).

### 2. Resolve the intent-generating agent

For each `create intent` statement:

1. Look up `agentAlias` in bindings from prior `discover … as …` lines.
2. If the alias is `intentGen` and no binding exists, query the registry for an intent-generating agent for the workspace domain.
3. If no URI is found, log an error and stop the script run.

### 3. Build the seed prompt

The Controller does **not** send only the quoted DSL prompt. It prepends machine-readable hints:

- **Storage hint** — e.g. `Observation report storage for this intent: prometheus.` plus instructions to set `icm:reportDestinations` accordingly.
- **Reporting interval hint** (optional) — If a later `request observation-report … frequency=…` line exists for the same `intentAlias`, the Controller derives seconds from that line and prepends a reporting-interval hint so the agent aligns Turtle with the scripted observation cadence.

Then the user's natural-language prompt from the DSL is appended.

### 4. Open the intent generation dialog

Script execution **pauses**. The Controller opens **Intent generation (A2A)** (`IntentGenSessionDialog`) with:

- `intentArtifactLabel` = DSL `intentAlias`
- `seedPrompt` = composed prompt above
- `wellKnownURI` = resolved agent card URL
- `createIntentStorage` = `graphdb` or `prometheus` from the DSL line
- `graphTargetBinding` = selected KG target (passed as A2A metadata `simulator.graphTarget`)

The dialog automatically sends the seed prompt as the first user message.

### 5. A2A message path

Each user/agent turn goes through:

1. **Browser** → `POST /api/a2a/message-send` (Controller backend)
2. **Controller** fetches the agent card from `wellKnownURI`, reads the JSON-RPC URL, and calls `message/send` (A2A v0.3) with:
   - `text` (user message)
   - persistent `taskId` / `contextId` (same dialogue for follow-ups)
   - optional `simulator` metadata: `graphTarget`, `createIntentStorage`, LLM preferences, reporting interval, Prometheus base URL
3. **Agent** runs one turn and returns `visibleText`

Task and context identifiers are reused so confirmation (`OK`) and adjustments stay in one session.

### 6. Persist Turtle and bind the alias

When the agent reply contains Turtle:

1. **Extract** Turtle from the reply (`extractIntentTurtle`).
2. **Ingest** via the selected KG target store endpoint (`persistIntentStoreUrl`), including `storage` and Prometheus/GraphDB base URLs when configured.
3. **Resolve canonical id** — Prefer the store response; otherwise parse `I…` from Turtle.
4. **Register** the intent with the Controller's intent registry (domain, id, storage, graph target).
5. **Bind** `intentAlias` → canonical id in `intentIdByAliasRef` and record observation storage in `intentStorageByAliasRef`.

The user closes the dialog; the script run resumes at the next statement.

If no KG target was selected, Turtle may still be parsed for a canonical id, but nothing is written to GraphDB.

## Intent-generating agent (`5g4data-intent-generation`)

The domain package is loaded by SimulatorAgentKernel. Its `manifest.json` wires workflow stages, classification rules, prompt modules, tools, validators, and postprocessors.

### Agent identity

From `metadata/a2a.agent-card.partial.json`:

- **Name:** `5g4data-intent-generating-agent`
- **Domain:** `telenor.5g4data-mistral-small4`
- **Skill:** `generate-intent` — create intent payloads for 5G4Data workloads

After `package load`, the clone serves the merged agent card and handles A2A traffic.

### Turn pipeline (SimulatorAgentKernel)

Each `message/send` triggers `TurnOrchestrator.runTurn`:

1. **Classify** — `WorkflowEngine.classifyIntent` scans the effective user text against keyword lists in `rules/classification.json` and sets flags such as `deployment`, `locality`, `networkQos`, `sustainability`, `coordination`, `reportToPrometheus`, etc.

2. **Build runtime context** — `RuntimeContextBuilder` / `CapabilityRouter` loads grounding data based on flags and `rules/context.json`:
   - Ontology and example summaries
   - Workload catalogue and selected chart objectives (when deployment/sustainability)
   - GraphDB datacenter candidates (when locality/deployment/network)

3. **Select prompt modules** — `workflow.dsl.json` defines stages (`base`, `deployment`, `locality`, `network`, `sustainability`, `coordination`, `repair`). Modules are included when their `whenIntentFlags` match. All turns always include `base`, `defaults`, `reporting-storage`, and `review`.

4. **Compose system prompt** — System blocks = package `prompts/system.md` + selected modules + runtime context + reporting interval hint (+ confirmation override when user typed `OK`).

5. **LLM main turn** — Model generates a reply (review summary or Turtle).

6. **Repair loop** — `RepairEngine` runs configured postprocessors, validates against `validators/output-policy.json`, and may invoke a repair LLM turn if policy violations are detected.

7. **SHACL validation** — Optional shapes validation with retries.

8. **Postprocessors** (`validators/postprocessors.json`, applied in order):
   - `uuidFix` — canonicalize placeholder IDs to UUIDv4 local names
   - `coordinationUtility` — inject utility functions for coordination intents
   - `reportingTriggers` — normalize report trigger structure
   - `requiredPrefixes` — ensure required `@prefix` declarations
   - `reportDestinations` — align `icm:reportDestinations` with requested storage

9. **Return** — Final text is sent back as `visibleText`.

### Confirmation workflow

The `review` prompt module requires a human-readable summary before final Turtle. The agent ends with:

> Type OK to confirm generation of Turtle.

`workflow.dsl.json` defines:

- **Accepted confirmation:** `ok`
- **On confirmation:** force final Turtle generation without asking again

The Controller user types `OK` in the dialog; the agent treats that as confirmation and emits raw Turtle (no markdown fences or narration).

### What the agent produces

A valid intent includes (depending on classified flags):

- `icm:Intent` with expectations (`DeploymentExpectation`, `SustainabilityExpectation`, `NetworkExpectation`, `CoordinationExpectation`, …)
- `icm:ObservationReportingExpectation` blocks with per-anchor report events and `icm:reportDestinations`
- Workload and metric conditions grounded in the ChartMuseum catalogue
- Optional coordination utility functions and `data5g:coordinates` links

See `ExampleIntentGenerated.ttl` and `docs/Example1.ttl` in this package for concrete shapes.

## Observation storage

The `storage` keyword on `create intent` affects three layers:

| Layer | Effect |
|-------|--------|
| **Seed prompt** | Storage hint prepended before the user's prompt |
| **Generated Turtle** | Postprocessor sets `icm:reportDestinations` to `data5g:graphdb` or `data5g:prometheus` |
| **Controller alias map** | `intentStorageByAlias` used when a later `request observation-report` omits `storage` |

Resolution order for observation datapoints (later script steps): `request observation-report … storage` override → Turtle `icm:reportDestinations` → create-intent alias map → default `graphdb`.

Prometheus metadata (query URLs) is still registered in the GraphDB metadata graph `http://intent-reports-metadata` regardless of storage choice.

## After `create intent`

Typical script continuation:

```text
extract metric-catalog for llmIntent as llmMetrics

discover observation-agent by domain telenor.5g4data as observationControl

request observation-report using observationControl for llmIntent instructions "…" as llmObservationSession
```

- **`extract metric-catalog`** — Reads conditions from the stored intent in GraphDB and binds metric names for the alias.
- **`request observation-report`** — Requires a resolved canonical intent id for `llmIntent` (from the create-intent binding). Opens a separate A2A dialog with the observation agent.

## Workload preview (without creating an intent)

The Controller **Show metrics** action resolves `create intent` prompts and calls the agent's control API extension `POST /v1/control/workload-preview` (see `metadata/control-api.extensions.json`). That returns catalogue workload and metric names without running full intent generation.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Script stops at create intent | No agent URI for `agentAlias`; run `discover intent-agent …` or fix registry/domain |
| Turtle not stored | No KG target selected in the Controller sidebar |
| Later step: "No intent id for …" | Dialog closed before Turtle was stored, or ingest failed — check run log |
| Agent asks clarifying questions | Prompt missing required detail (e.g. locality for deployment); answer in the dialog |
| Repair/SHACL warnings in output | Output policy or shapes violation; agent may embed a SHACL report in the Turtle |

## Related documentation

- [`coordination-using-utility-function.md`](coordination-using-utility-function.md) — coordination triggers and utility function generation
- [`../skills/SKILL.md`](../skills/SKILL.md) — TM Forum intent authoring rules for the agent
- [`../../../SimulatorAgentKernel/docs/ControllerIntentNameBindingDesign.md`](../../../SimulatorAgentKernel/docs/ControllerIntentNameBindingDesign.md) — logical name binding design
- [`../../../README.md`](../../../README.md) — observation storage environment and Prometheus setup
