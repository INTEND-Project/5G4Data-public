Fragment: coordination bundle (body only).

**Note:** kernel-mistral.small4 builds this fragment deterministically from prior deployment/sustainability locals (`tools/buildCoordinationFragment.ts`). The LLM path is fallback only when stub assembly fails.

Output rules:
- Return **Turtle body only** — no `@prefix` lines, no `icm:Intent` block, no markdown fences, no narration, no apologies or explanations.
- **Mandatory:** output must include `data5g:CE__ID_COORDINATION_1__` and `data5g:RE__ID_REPORTING_COORDINATION_1__` subject lines.
- Use placeholders: `data5g:CE__ID_COORDINATION_1__`, `data5g:RE__ID_REPORTING_COORDINATION_1__`, `data5g:U_coord`, `data5g:UP_coord`, `data5g:utilityFn_symmetric`.
- Reference **existing** `deploymentDeLocal`, `sustainabilitySeLocal`, and `conditionLocals` from draft context — do not create new `icm:Condition` subjects.

Emit (each as its own block ending with `.`):
1. **Minimal utility stub only** — `data5g:U_coord a ut:UtilityFunction ; dct:description "coordination utility draft" .` (postprocessor expands on assembled intent).
2. `data5g:CoordinationExpectation` with `icm:target data5g:coordination-service`, `log:allOf` listing draft `conditionLocals`, `ut:utility data5g:U_coord`, `data5g:coordinates` listing `deploymentDeLocal` and `sustainabilitySeLocal`.
3. `data5g:durationCoordination_CE…` and `data5g:TenMinuteReportEventCoordination_CE…`.
4. `icm:ObservationReportingExpectation` targeting `data5g:coordination-service`.

Do **not** emit `mf:logistic` or `utilityFn_*` blocks in this fragment.

Example shape:

```
data5g:U_coord a ut:UtilityFunction ;
    dct:description "coordination utility draft" .

data5g:CE__ID_COORDINATION_1__ a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:CO__ID_CONDITION_1__, data5g:CO__ID_CONDITION_SUST_1__ ;
    ut:utility data5g:U_coord ;
    data5g:coordinates data5g:DE__ID_DEPLOYMENT_1__, data5g:SE__ID_SUSTAINABILITY_1__ .

data5g:durationCoordination_CE__ID_COORDINATION_1__ a time:DurationDescription ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventCoordination_CE__ID_COORDINATION_1__ a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:durationCoordination_CE__ID_COORDINATION_1__ ) ;
    imo:eventFor data5g:CE__ID_COORDINATION_1__ .

data5g:RE__ID_REPORTING_COORDINATION_1__ a icm:ObservationReportingExpectation ;
    icm:target data5g:coordination-service ;
    icm:reportDestinations [ a rdfs:Container ; rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ; rdfs:member data5g:TenMinuteReportEventCoordination_CE__ID_COORDINATION_1__ ] .
```

Symmetric coordination: equal logistic limits for token and energy metrics unless the prompt requests weighted coordination.
