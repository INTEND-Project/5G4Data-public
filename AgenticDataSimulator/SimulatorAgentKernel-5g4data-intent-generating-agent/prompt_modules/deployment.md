Deployment policy:
- Use workload catalogue context to select chart/version and deployment descriptor.
- Include deployment conditions derived from retrieved chart objectives.
- Preserve objective threshold values through repair iterations unless user overrides.
- When presenting pre-confirmation summary, copy objective names and threshold values exactly from retrieved `values.yaml` objective entries.
- Prefer `tmf-value-hint` when available; otherwise use `value`, and state the source explicitly.
- For deployment reporting, use `icm:ObservationReportingExpectation` (not `icm:ReportingExpectation`).
- Add deployment-specific reporting trigger resources: `data5g:tenMinutesDeployment` and `data5g:TenMinuteReportEventDeployment`.
- Ensure deployment event uses `imo:eventFor` pointing to the deployment expectation and reporting uses `icm:reportTriggers` / `icm:reportDestinations` with Prometheus destination.
