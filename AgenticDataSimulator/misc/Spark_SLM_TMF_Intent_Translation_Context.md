# Context handoff: SLM for NL → TM Forum intent translation (5G4Data)

Use this file as Cursor context on the DGX Spark to continue the discussion. It summarizes decisions and rationale from a prior chat on the AgenticDataSimulator workstation (not Spark-local code unless noted).

**Date of dialogue:** July 2026  
**Hardware target:** NVIDIA DGX Spark (GB10, 128 GB unified LPDDR5x memory)  
**Primary goal:** Make a small language model capable of translating natural language into formal TM Forum Intent Ontology (TIO) Turtle for the 5G4Data use case.

---

## 1. Product / system context

The INTEND / 5G4Data simulator already generates TM Forum intents and observation reports via multiagent packages:

| Piece | Role |
|-------|------|
| `SimulatorAgentKernel` / `LangGraphAgents` | Agent runtimes |
| Intent-generating packages | NL → Turtle (confirm/OK, SHACL, optional GraphDB persist) |
| `5g4data-intent-mistral-small4-*` | Fragmented generation experiment (DE/SE/NE/RE pieces) |
| ChartMuseum workload catalogue | Authoritative objectives / sustainability metrics |
| GraphDB infra KG | Locality / nearest edge datacenter |
| SHACL + postprocessors | Correctness gate (IDs, scaffolding, subset rules) |

**Important:** Catalogue facts and DC IDs must stay **retrieved at runtime**, not baked into fine-tuned weights.

Existing agent pattern that works well for SLMs: **fragmented generation** (one Turtle fragment at a time) + **minimal system prompts** + **validate/repair loop**.

---

## 2. What a TM Forum ReportingExpectation is (official TIO, not repo dialect)

From TM Forum Intent Common Model (**TR290A** / **TR290B**) and TIO v3.6 patterns:

- `icm:ReportingExpectation` answers **when** and **where** reports are produced.
- It does **not** encode Kepler, Kubernetes, or metric names by itself.
- Metrics belong on a **PropertyExpectation** + **Condition** (`met:Metric`, `met:lastValue`, quantity ops).
- For metric observations in reports, use `icm:ObservationReportingExpectation` (TR290B).
- Shape:
  - `icm:target` → `icm:Target`
  - `icm:reportTriggers` → `rdfs:Container` of events (when)
  - `icm:reportDestinations` → `rdfs:Container` of IMFs / receivers (where)

Example intent of “reports every 10 minutes on total energy for `small_llm_inference` (Kepler in K8s)”:

| Requirement | TIO place |
|-------------|-----------|
| Every 10 minutes | `reportTriggers` with a time-based `imo:Event` (e.g. `PT10M`) |
| Where reports go | `reportDestinations` |
| Total energy consumption | `met:Metric` + PropertyExpectation/Condition |
| `small_llm_inference` | Target member (domain resource) |
| Kepler | Measurement backend only — outside ICM vocabulary |

Published TIO frequency examples emphasize on-change (`imo:Complies`, `imo:Degrades`, …) and on-demand (no triggers); periodic cadence is still in scope of TR290A (“event, time, …”) via a time-conditioned trigger event.

*(The 5G4Data repo also has a project-specific dialect with `data5g:SustainabilityExpectation`, `energy-consumption_CO…`, etc. Do not confuse that with pure TIO when discussing ontology purity.)*

---

## 3. Best overall approach (not a single technique)

**Recommended hybrid (in priority order):**

1. **Prompt templates + fragmented generation** — structural control  
2. **Tool / narrow RAG grounding** — ChartMuseum rows, GraphDB locality, few-shot same-shape intents, short “legal subset” cards (not full TIO dump)  
3. **Light QLoRA fine-tune** — teach the Turtle *dialect* / schema habits  
4. **SHACL + deterministic postprocess + repair** — source of truth for correctness  

Optional later: constrained decoding / Turtle grammar for the SLM decoder.

**Avoid as sole strategy:**
- Full-ontology RAG  
- One-shot full-intent generation on a tiny model  
- Fine-tuning catalogue versions / thresholds into weights  

---

## 4. Model recommendations (Spark)

### 4.1 Best SLM to *start* with (local inference / A/B)

**Primary:** `Qwen2.5-14B-Instruct` or `Qwen2.5-Coder-14B-Instruct`  
- Prefer **Coder** when the model mostly emits Turtle fragments.  
- Prefer **Instruct** if it also does planning/clarification turns.

**Control / already useful baseline:** whatever is already on Spark (e.g. `gpt-oss:20b` via Ollama) — keep for A/B, not as the assumed winner.

**Cloud quality ceiling (existing agent):** `mistral-small-2603` used by the mistral-small4 generating agents — use as comparison until local model closes the SHACL gap.

### 4.2 Best base to *fine-tune* (independent of downloads)

**Fine-tune:** `Qwen2.5-Coder-14B-Instruct`  
**Fallback:** `Qwen2.5-14B-Instruct`

Why: formal/DSL priors, 14B LoRA/QLoRA sweet spot on 128 GB Spark, mature Unsloth/Axolotl/TRL recipes, better ceiling than 7–8B, faster iteration than 32B+.

**Do not fine-tune first:** 7–8B as the only bet, 70B hot-path translator, obscure checkpoints with weak LoRA ecosystems, baking live catalogue facts into adapters.

---

## 5. Suggested Spark architecture

```text
NL request
  → planner (which expectations? which workload?)
  → tools: ChartMuseum + GraphDB (authoritative facts)
  → RAG: few-shot same-shape intents + subset rule cards
  → LoRA-tuned SLM fragment generators (DE / SE / NE / RE)
  → assemble + deterministic postprocess
  → SHACL / policy validate
  → repair (failing constraints only) or regenerate fragment
  → persist
```

**Training data recipe:**
1. Enumerate legal 5G4Data shapes (deployment-only, sustainability-only, network, mixes, coordination).  
2. Generate NL paraphrases per shape.  
3. Teacher (stronger model) + templates → Turtle; **keep only SHACL-valid**.  
4. Train QLoRA on `(NL + compact grounding JSON → fragment Turtle)`.  
5. Hold out real user prompts; score SHACL pass rate, expectation-selection F1, metric-stem accuracy, repair iterations.

---

## 6. Eval checklist (when continuing on Spark)

- [ ] Serve candidate model via Ollama or vLLM (OpenAI-compatible `/v1`)  
- [ ] Point fragmented intent agent at Spark (`OPENAI_BASE_URL`, `OPENAI_MODEL`)  
- [ ] A/B: Qwen2.5-14B(-Coder) vs current Spark baseline vs cloud Mistral Small  
- [ ] Build validator-filtered synthetic dataset  
- [ ] QLoRA on Coder-14B; export adapter / merged GGUF or safetensors for serving  
- [ ] Measure latency for multi-fragment turns on Spark  

---

## 7. Open questions to continue on Spark

1. Prefer Ollama vs vLLM/TensorRT-LLM for LoRA serving on GB10?  
2. Train one multi-fragment model vs separate adapters per fragment (deployment / sustainability / network / reporting)?  
3. How large is the current gold/synthetic intent corpus, and can the existing SHACL shapes be the only accept filter?  
4. Should the Spark model target pure TIO Turtle, the 5G4Data `data5g:` dialect, or both?  
5. Constrained decoding: invest now, or after LoRA + repair plateau?

---

## 8. Related paths in AgenticDataSimulator (workstation repo)

- Intent authoring skill / subset rules: `SimulatorAgentPackages/5g4data-intent-*-generating-agent/skills/SKILL.md`  
- Fragmented generation: `SimulatorAgentKernel-mistral.small4`, LangGraph mistral-small4 package  
- Spark Ollama env example: `spark-ollama.env.example`  
- Architecture overview: `SimulatorAgentKernel/docs/MultiagentDataGenerationSimulator.md`

---

## 9. One-line summary for Cursor

> We want a DGX Spark–hosted SLM that compiles NL into SHACL-valid 5G4Data/TIO Turtle via fragmented generation + retrieval grounding + QLoRA; best fine-tune base is Qwen2.5-Coder-14B-Instruct; do not bake catalogue facts into weights; keep validation/repair mandatory.
