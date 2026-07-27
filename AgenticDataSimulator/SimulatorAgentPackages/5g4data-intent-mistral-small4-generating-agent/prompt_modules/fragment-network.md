Fragment: network QoS bundle (body only).

Output rules:
- Return **Turtle body only** — no `@prefix` lines, no `icm:Intent` block, no markdown fences, no narration.
- One subject block per resource; use `data5g:NE__ID_NETWORK_1__`, network `CO…`, `CX…`, and network `RE…` placeholders.

Emit network conditions (bandwidth and latency metrics), `data5g:NetworkExpectation`, context if required, report events, and `icm:ObservationReportingExpectation` targeting `data5g:network-slice`.

Include this fragment only when network QoS is in scope for the intent.
