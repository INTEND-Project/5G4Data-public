---
name: tmf-observation-reporting
description: Generate TM Forum observation reports for a given intent identifier using ObservationReportingExpectation and Condition definitions, with optional runtime overrides.
---

# 5G4Data Observation Reporting Skill

## Purpose

Generate TM Forum formatted observation payloads from an existing intent, including baseline scheduling and optional runtime override behavior.

## Required Input

- `intent_id` identifying an existing intent in storage.
- Optional operation instructions as:
  - natural language text, and/or
  - structured JSON with `metricValueSpans`, `eventRules`, `timeWindows`.

## Rules

- Only report metrics referenced by in-scope Conditions linked to ObservationReportingExpectation targets.
- Extract baseline frequency from report trigger delay in the intent.
- Apply override precedence:
  1. time window
  2. event rule
  3. baseline plan
- Keep output in simulator-compatible TM Forum observation Turtle format.
- If `--noGraphDB` mode is active, print report payloads and skip GraphDB writes.

## Continuous streaming (REPL)

When the package is loaded in an interactive clone, it supports package-owned `observe` commands:

- `observe start intent_id=<id>`: starts continuous observation generation streams.
- `observe status`: lists active streams for the session.
- `observe stop`: stops all streams for the session.
- `observe override metric=<metric_name> min=<n> max=<n>`: runtime span override.

Debug logging behavior (`--debug`):

- stream metadata: `logs/observations-stream.ndjson`
- full Turtle per metric: `logs/observations-by-metric/<metric_name>.ttl`
