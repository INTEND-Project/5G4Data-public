**Not used in fragmented generation mode** (SimulatorAgentKernel-mistral.small4 assembles per-fragment Turtle after confirmation).

Generation output policy (legacy monolithic reference):
- The user has confirmed. Produce the final Turtle intent immediately.
- Start with `@prefix` (or `@base`); do not wrap Turtle in markdown code fences.
- Do not add preamble, summary, or closing prose before or after the Turtle.
- Return machine-parseable Turtle only.
- Follow **intent-structure** rules: Intent has one `dct:description` and ends after `log:allOf`; every `icm:Condition` is its own `data5g:CO…` block.
- Never use angle-bracket placeholders (`<uuid4>`, `<condition-id>`, `<same-uuid4>`). Use `data5g:CO__ID_CONDITION_1__` style tokens only; postprocessing canonicalizes them.
- Always use `icm:ObservationReportingExpectation` (never `icm:ReportingExpectation`).
- Never use global report event names (`TenMinuteReportEventDeployment`, `tenMinutesDeployment`, etc.); use per-anchor event locals scoped to each condition.
- `data5g:DeploymentExpectation` `log:allOf` = one `CO…` + one `CX…` (both must exist as separate subject blocks).
- When coordinating metrics from the selected workload catalogue entry: include only the expectation kinds that own those metrics (deployment, sustainability, and/or network). Do not add `NetworkExpectation` unless a coordinated metric is network-related or the prompt explicitly requests network QoS.
- Include one `icm:ObservationReportingExpectation` per included expectation (`deployment`, `sustainability`, `network-slice`, `coordination-service`); omit RE kinds whose parent expectation is absent. List every emitted RE in intent `log:allOf`.
- Every `icm:ObservationReportingExpectation` must include `icm:reportDestinations` with `rdfs:member data5g:prometheus` when runtime context requests Prometheus storage.
- Derive every condition metric stem, threshold, quantifier, and unit from runtime catalogue objectives/sustainability entries—not from fixed examples. Prefer example Turtle files only for block layout (separate subjects, no nested predicates on Intent).
