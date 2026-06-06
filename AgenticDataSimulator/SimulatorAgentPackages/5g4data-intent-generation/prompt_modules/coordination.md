Coordination policy (inCoord):

When the user prompt requests coordination (`coordination`, `symmetric coordination`, `weighted coordination`, etc.):

1. Include `data5g:CoordinationExpectation` in the root intent `log:allOf` with placeholder `data5g:CE__ID_COORDINATION_1__`.
2. Target must be `data5g:llm-service`.
3. Add one coordination condition per coordinated metric under CE `log:allOf` (not a fixed TPS+energy pair—choose metrics named in the prompt).
4. Emit `ut:utility data5g:U_coord` and `data5g:coordinates` listing the expectation(s) that own the coordinated metrics (typically `DeploymentExpectation`, `SustainabilityExpectation`, and/or `NetworkExpectation`—not always all three).
5. Include `NetworkExpectation` only when coordinated metrics are network-related (`bandwidth`, `latency`, or other network metric stems) **or** the prompt explicitly requests network QoS/latency/bandwidth/connectivity. Do **not** add network solely because coordination was requested.
6. Add `icm:ObservationReportingExpectation` targeting `data5g:llm-service` with per-anchor report event (postprocessor will scope triggers).

Utility function rules:

- Use only these namespaces: `ut:` (Utility), `fun:` (FunctionOntology), `mf:` (MathFunctions), `time:` (TimeOntology). Never use `UtilityFunctions/` IRIs or invent `uf:`/`ns1:` prefixes.
- One utility argument per CE condition: `data5g:U_arg_<metric-stem>` where `<metric-stem>` matches the condition metric local without `_CO…` suffix.
- Emit a draft `data5g:U_coord`, `data5g:UP_coord`, and `data5g:utilityFn_<profile>` block; the coordination utility postprocessor normalizes numeric parameters and wiring.
- Symmetric profile (`symmetric coordination`): equal sub-utility limits across all coordinated metrics; prefer `mf:logistic` for each.
- Weighted profile (`weighted coordination`, `prioritize …`): unequal limits reflecting emphasis; secondary energy-like metrics may use `mf:poly`.
- Severity cues: `critical`/`strict` → stricter curves; `trivial`/`lenient` → gentler curves; default is major.

Reference patterns: `examples/intent_utility_symmetric.ttl` and `examples/intent_utility_weighted.ttl`. Names like `U_arg_tps` in those files are specific to their metrics—not fixed templates.

Review checklist additions:

- Confirm `CoordinationExpectation` is present when coordination was requested.
- Confirm each CE condition metric has a matching `U_arg_<metric-stem>` in the utility function.
- Confirm `data5g:coordinates` references the expectation(s) that own the coordinated metrics (deployment, sustainability, and/or network as applicable).
- Confirm `NetworkExpectation` is present only when coordinated metrics or the prompt require network QoS—not by default for every coordination request.
