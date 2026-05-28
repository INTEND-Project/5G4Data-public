# InSustain Integration

Energy-aware sustainability monitoring for 5G4Data intents, provided by Ericsson.

## How it works

```
IntentAgent generates intent with data5g:SustainabilityExpectation
  -> inServ detects SE, forwards full intent to InSustain
  -> InSustain extracts sustainability conditions (powerConsumption, energyConsumption)
  -> InSustain monitors energy, pushes observation reports back
```

InSustain receives the **full intent** (including DE/NE) and ignores everything except the `SustainabilityExpectation` and its conditions.

## Files

| File | Purpose |
|------|---------|
| `SustainabilityMetrics.ttl` | Vocabulary defining the abstract metrics InSustain exposes |
| `example-intent-with-sustainability.ttl` | Example intent combining DE + SE (correct metric usage) |
| `sample-workload-values.yaml` | Helm chart `values.yaml` sustainability section contract |

## Metric contract

Intents request monitoring using **abstract metric names**:

| Metric | Unit | Description |
|--------|------|-------------|
| `powerConsumption` | W (watt) | Instantaneous power draw |
| `energyConsumption` | J (joule) | Cumulative energy over reporting interval |

These appear in intent conditions as:
```turtle
data5g:powerConsumption_CO<id>
data5g:energyConsumption_CO<id>
```

InSustain resolves these internally to Kepler/hardware metrics. The intent MUST NOT reference Kepler metric names directly (e.g., `kepler_container_cpu_joules_total`).

## Configuration

inServ routes to InSustain via:
```
INSUSTAIN_BASE_URL=http://<insustain-host>/tmf-api/intentManagement/v5
INSERV_INSUSTAIN_READY=true
```

## Workload Catalog integration

Any Helm chart with a `sustainability` section in `values.yaml` is eligible for energy monitoring. The IntentAgent uses `tmf-value-hint` as default thresholds when the user doesn't specify exact values.
