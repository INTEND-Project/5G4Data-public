# data5g-onto

TIO-compatible **ontology extension** for 5G4Data intents (classes, named targets, key properties).

Validation **rules** are not here — they live in each intent agent package under `validation/skill_subset_intent_shapes.ttl`.

## Offline validation with tio-shacl

From `tio-shacl/` (after `make setup-tio`):

```bash
INTENT=../SimulatorAgentPackages/5g4data-intent-mistral-small4-generating-agent/examples/intent_utility_weighted.ttl

uv run tio-shacl validate "$INTENT" \
  -O ontology \
  -O ../data5g-onto \
  -v
```

`-O` supplies ontology graphs that are unioned with the intent before SHACL runs. Passing both TIO `ontology/` and this directory is required when you use `-O` (it replaces the default ontology resolution).

## Contents

| File | Role |
|------|------|
| `Data5gExtensionOntology.ttl` | `rdfs:subClassOf icm:Expectation`, `data5g:* a icm:Target`, common properties |
