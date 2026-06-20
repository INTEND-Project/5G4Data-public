Network policy:
- Use only bandwidth and latency conditions for NetworkExpectation.
- Metric property stems for network conditions: `data5g:bandwidth_<condition-id>` and `data5g:latency_<condition-id>` (placeholders `bandwidth___ID_CONDITION_BANDWIDTH_1__`, `latency___ID_CONDITION_LATENCY_1__` before postprocessing). Do not use `networklatency_*`.
- Workload catalogue charts do not define network objectives. When the user mentions 4K video, streaming, near-realtime connectivity, or good network for video upload, infer both bandwidth and latency conditions even without catalogue entries.
- Suggest thresholds from user context when stated; otherwise use latency **50 ms** (`quan:smaller`) and bandwidth **300 mbit/s** (`quan:larger`). The postprocessor applies these defaults when values are missing.
- Keep units explicit (`mbit/s`, `ms`) unless grounded context requires otherwise.
- For network reporting, use `icm:ObservationReportingExpectation` (not `icm:ReportingExpectation`) when network expectation exists.
- Add network-specific reporting trigger resources scoped to the anchor condition or expectation: `data5g:durationNetwork_CO<condition-id>` (or `durationNetwork_NE<id>`) and `data5g:<IntervalLabel>ReportEventNetwork_<anchor>` (never global `TenMinuteReportEventNetwork`).
- Ensure network event uses exactly one `imo:eventFor` pointing to the network expectation and reporting uses `icm:reportTriggers` / `icm:reportDestinations` per the reporting-storage policy. Use the session reporting interval for `time:numericDuration`.
