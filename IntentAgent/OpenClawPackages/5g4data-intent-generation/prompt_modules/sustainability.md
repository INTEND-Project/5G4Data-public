Sustainability policy:
- Use workload catalogue context to include sustainability conditions derived from retrieved chart `values.yaml` `sustainability` entries.
- Generate one `icm:Condition` per extracted sustainability metric entry unless the user explicitly narrows scope.
- Group sustainability conditions under one `data5g:SustainabilityExpectation` with `icm:target data5g:sustainability`.
- Reuse the existing deployment context when it already contains required fields (for example `Application`, `DataCenter`, and `DeploymentDescriptor`) instead of creating a duplicate partial sustainability context.
- Preserve metric names and threshold values exactly from runtime context unless the user overrides.
- Prefer `tmf-value-hint` when available; otherwise use `value`, and state the source explicitly.
- For sustainability reporting, use `icm:ObservationReportingExpectation` (not `icm:ReportingExpectation`).
- Add sustainability-specific reporting trigger resources: `data5g:tenMinutesSustainability` and `data5g:TenMinuteReportEventSustainability`.
- Ensure sustainability event uses `imo:eventFor` pointing to the sustainability expectation and reporting uses `icm:reportTriggers` / `icm:reportDestinations` with Prometheus destination.
