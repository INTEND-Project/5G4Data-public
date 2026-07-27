Override rules:
- Normalize structured overrides:
  - `metricValueSpans[]` entries with `conditionId|metric`, `min`, `max`.
  - `eventRules[]` entries with event descriptor and temporary behavior.
  - `timeWindows[]` entries with bounded intervals and override parameters.
- Precedence:
  1) time window override
  2) event rule override
  3) baseline plan
- Reject invalid override references (unknown condition/metric, invalid min/max, invalid time range).
