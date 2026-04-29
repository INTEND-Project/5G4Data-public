Network policy:
- Use only bandwidth and latency conditions for NetworkExpectation.
- Keep units explicit (`mbit/s`, `ms`) unless grounded context requires otherwise.
- For network reporting, use `icm:ObservationReportingExpectation` (not `icm:ReportingExpectation`) when network expectation exists.
- Add network-specific reporting trigger resources: `data5g:tenMinutesNetwork` and `data5g:TenMinuteReportEventNetwork`.
- Ensure network event uses `imo:eventFor` pointing to the network expectation and reporting uses `icm:reportTriggers` / `icm:reportDestinations` with Prometheus destination.
