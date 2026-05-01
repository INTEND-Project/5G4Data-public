# Tests for 5g4data-intent-observations

Recommended test matrix:

1. Frequency extraction
   - Intent has minute-based delay -> verify seconds conversion.
   - Intent has hour-based delay -> verify seconds conversion.
   - Missing/invalid delay -> fallback frequency is applied.

2. Condition scope enforcement
   - Only Conditions referenced under expectations mapped by ObservationReportingExpectation are reported.
   - Unknown condition in override is rejected.

3. Override precedence
   - Time window override beats event and baseline.
   - Event override beats baseline outside time window.
   - Baseline used when no matching override exists.

4. Payload format parity
   - Output includes `met:Observation`, `met:observedMetric`, `met:observedValue`, `met:obtainedAt`.
   - Metric naming follows `<targetProperty>_<conditionId>`.

5. `--noGraphDB` mode behavior
   - GraphDB writes are skipped.
   - Payload is printed in interactive output with explicit skip marker.
