---
name: tmf-observation-reporting-schema-synth
description: Generate TM Forum observation reports for a given intent via NL→ConstraintDocument→deterministic renderer (historic and streaming).
---

# 5G4Data Schema-Synth Observation Reporting Skill

## Purpose

Generate TM Forum formatted observation payloads from an existing intent by mapping natural-language observation instructions to a **ConstraintDocument** schema, then rendering deterministic time series (historic replay or wall-clock streaming).

## Required Input

- `intent_id` identifying an existing intent in storage.
- Structured synthetic globals and per-metric natural language:
  - `mode=historic|streaming`
  - `frequency=…s`
  - historic: `start=` / `stop=` (UTC)
  - one or more `metric=` compounds matching intent Conditions

## Rules

- Only report metrics referenced by in-scope Conditions linked to ObservationReportingExpectation targets.
- Prefer constraint bands, recurring windows, episodes (dip/spike), counters, and process models (level / seasonality / AR(1) / shocks) over free-form code.
- Prometheus labels must use production conventions (`job=intent_reports`, canonical `intent_id`, `condition_id`).
- If `--noGraphDB` mode is active, print report payloads and skip GraphDB writes.

## Continuous streaming (REPL)

When the package is loaded in an interactive clone, it supports package-owned `observe` commands:

- `observe start intent_id=<id>`: starts continuous observation generation streams (legacy random spans).
- `observe status`: lists active streams for the session.
- `observe stop`: stops all streams for the session.
- `observe override metric=<metric_name> min=<n> max=<n>`: runtime span override.

## Schema-synth multi-metric runs

Structured prompts (`intent_id=`, `mode=streaming|historic`, `frequency=…`, repeated `metric=…`) map each metric’s instructions to a ConstraintDocument (LLM when API keys are set, otherwise heuristic), then spawn `schemaSynthMetricWorker` (`observe synthetic …` aliases the same DSL). See `prompt_modules/observe_stream.md`.

Debug logging behavior (`--debug`):

- observation log (always, last N lines per metric): `logs/observations-<metric>.ndjson` (default N=100 via `--obsLogN` / `OBS_LOG_N`; `OBSERVATION_LOG_PATH` to override log directory)
- constraint program log (per metric, on mapping): `logs/observation-program-<metric>.js`
- stream metadata (debug): `logs/observations-stream.ndjson`
- full Turtle per metric (debug): `logs/observations-by-metric/<metric_name>.ttl`
