Fragment: deployment bundle (body only).

Output rules:
- Return **Turtle body only** — no `@prefix` lines, no `icm:Intent` block, no markdown fences, no narration.
- One subject block per resource; each block ends with `.` on its own line.
- Use placeholders: `data5g:CO__ID_CONDITION_1__`, `data5g:CX__ID_CONTEXT_1__`, `data5g:DE__ID_DEPLOYMENT_1__`, `data5g:RE__ID_REPORTING_DEPLOYMENT_1__`.
- Never emit angle-bracket tokens (`<uuid4>`).

Emit in order:
1. One `data5g:CO… a icm:Condition` per deployment catalogue objective from runtime context (`objectives[]`).
2. One `data5g:CX… a icm:Context` with `data5g:Application`, `data5g:DataCenter`, `data5g:DeploymentDescriptor` from runtime grounding.
3. `data5g:DE… a data5g:DeploymentExpectation, icm:Expectation, icm:IntentElement` with `icm:target data5g:deployment`, `log:allOf` listing deployment `CO…` and `CX…`, and reporting interval on the expectation.
4. Duration + report event scoped to deployment CO: `data5g:durationDeployment_CO…`, `data5g:TenMinuteReportEventDeployment_CO…`.
5. `icm:ObservationReportingExpectation` targeting `data5g:deployment` with `icm:reportDestinations` / `icm:reportTriggers` per reporting-storage policy.

Follow deployment policy from the deployment module; trust runtime context for chart, datacenter, thresholds, and units.

**Critical:** each resource is its own block ending with `.` — never append `time:delay`, `rdfs:subClassOf`, or report-event predicates to the `DeploymentExpectation` block. Example shape:

```
data5g:CO__ID_CONDITION_1__ a icm:Condition ; ... .

data5g:CX__ID_CONTEXT_1__ a icm:Context ; ... .

data5g:DE__ID_DEPLOYMENT_1__ a data5g:DeploymentExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO__ID_CONDITION_1__, data5g:CX__ID_CONTEXT_1__ ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:durationDeployment_CO__ID_CONDITION_1__ a time:DurationDescription ; ... .

data5g:TenMinuteReportEventDeployment_CO__ID_CONDITION_1__ a rdfs:Class ; ... .

data5g:RE__ID_REPORTING_DEPLOYMENT_1__ a icm:ObservationReportingExpectation ; ... .
```
