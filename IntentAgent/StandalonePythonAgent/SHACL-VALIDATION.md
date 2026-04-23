# SHACL Validation for StandalonePythonAgent

This document explains the SHACL profile created for validating generated intents against the constrained modeling subset used by `StandalonePythonAgent`.

## Purpose

`StandalonePythonAgent` follows the intent-authoring rules in `../SKILLs/SKILL.md`, which intentionally uses a strict subset of the TM Forum intent model plus 5G4Data conventions.

To make this enforceable, a concrete SHACL shapes file is provided:

- `validation/skill_subset_intent_shapes.ttl`

The goal is practical validation of generated Turtle intents before they are persisted or sent downstream.

## What Is Validated

The SHACL profile enforces the following key rules.

### 1) Intent root requirements

- `icm:Intent` must have:
  - exactly one `dct:description`
  - exactly one `imo:handler`
  - exactly one `imo:owner`
  - a `log:allOf` list
- Members of intent `log:allOf` are restricted to:
  - `data5g:DeploymentExpectation`
  - `data5g:NetworkExpectation`
  - `icm:ReportingExpectation`

### 2) Expectation targets

- `data5g:DeploymentExpectation` must target `data5g:deployment`.
- `data5g:NetworkExpectation` must target `data5g:network-slice`.
- `icm:ReportingExpectation` targets are limited to:
  - `data5g:deployment`
  - `data5g:network-slice`

### 3) Condition structure

- `icm:Condition` must contain one `set:forAll`.
- `set:forAll` must reference exactly one `icm:valuesOfTargetProperty` IRI.
- A quantity comparator must be present under `set:forAll`:
  - `quan:smaller`, `quan:larger`, or `quan:inRange`.

### 4) Network condition coverage

Each `data5g:NetworkExpectation` must include referenced conditions that cover both:

- a bandwidth metric property (`data5g:bandwidth_*`)
- a latency metric property (`data5g:networklatency_*` or `data5g:latency_*`)

These checks are implemented with SHACL SPARQL constraints.

### 5) Reporting expectation coverage

If an intent includes:

- a deployment expectation, it must also include a reporting expectation targeting `data5g:deployment`.
- a network expectation, it must also include a reporting expectation targeting `data5g:network-slice`.

These checks are also implemented with SHACL SPARQL constraints.

### 6) Context consistency checks

- If a context has `data5g:DeploymentDescriptor`, it must also have `data5g:DataCenter`.
- If a context has `data5g:appliesToRegion`, it must also have `data5g:appliesToCustomer`.
- `data5g:appliesToRegion` must point to a `geo:Feature`.

## Notes on Scope

This profile is intentionally focused on the generated-intent subset used by the agent. It is not a complete formalization of all TM Forum ontology constraints.

Examples of checks that are intentionally out of scope (for now):

- live catalogue verification of deployment descriptor URLs
- GraphDB-backed nearest-edge data center verification
- UUID4 lexical validation of all local resource IDs
- deep semantic validation of chart-objective-to-condition traceability

## File Location

- Shapes file: `validation/skill_subset_intent_shapes.ttl`
- This documentation: `SHACL-VALIDATION.md`

## How To Run Validation Locally

Use any SHACL engine that supports SHACL Core and SHACL SPARQL constraints (for example, `pyshacl`).

Example with `pyshacl`:

```bash
pip install pyshacl rdflib
pyshacl \
  -s "IntentAgent/StandalonePythonAgent/validation/skill_subset_intent_shapes.ttl" \
  -d "Intent-Simulator/intents/<intent-file>.ttl" \
  -f human
```

If your data graph requires ontology imports/prefix support beyond the data file, include additional options supported by your chosen validator.

## Expected Validation Outcome

- **Conforms**: generated intent follows the supported subset and required structure.
- **Non-conforms**: one or more shape constraints failed; inspect the reported focus node and violated constraint message for remediation.

