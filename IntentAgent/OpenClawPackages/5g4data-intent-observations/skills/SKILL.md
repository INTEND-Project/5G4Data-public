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
