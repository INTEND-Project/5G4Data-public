Network policy:
- Use only bandwidth and latency conditions for NetworkExpectation.
- Metric property stems for network conditions: `data5g:bandwidth_<condition-id>` and `data5g:latency_<condition-id>` (placeholders `bandwidth___ID_CONDITION_BANDWIDTH_1__`, `latency___ID_CONDITION_LATENCY_1__` before postprocessing). Do not use `networklatency_*`.
- Keep units explicit (`mbit/s`, `ms`) unless grounded context requires otherwise.
- For network reporting, use `icm:ObservationReportingExpectation` (not `icm:ReportingExpectation`) when network expectation exists.
- Add network-specific reporting trigger resources: `data5g:tenMinutesNetwork` and `data5g:TenMinuteReportEventNetwork`.
- Ensure network event uses `imo:eventFor` pointing to the network expectation and reporting uses `icm:reportTriggers` / `icm:reportDestinations` per the reporting-storage policy.
