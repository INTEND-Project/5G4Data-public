Observation report storage policy:
- Default destination: `data5g:graphdb` unless the user or runtime context specifies Prometheus.
- When Prometheus is requested: every `icm:ObservationReportingExpectation` must include:
  `icm:reportDestinations [ a rdfs:Container ; rdfs:member data5g:prometheus ] ;`
- When GraphDB is requested (default): use `rdfs:member data5g:graphdb` instead of `data5g:prometheus`.
- Keep `icm:reportTriggers` and per-anchor report event classes unchanged (do not switch to global TenMinute event names).
- Do not omit `icm:reportDestinations` on any observation reporting expectation.
