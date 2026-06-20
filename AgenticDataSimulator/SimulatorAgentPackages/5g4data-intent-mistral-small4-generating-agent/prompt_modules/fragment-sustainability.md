Fragment: sustainability bundle (body only).

Output rules:
- Return **Turtle body only** — no `@prefix` lines, no `icm:Intent` block, no markdown fences, no narration.
- **Mandatory:** output must include `data5g:SE…` and `data5g:RE…` subject lines.
- One subject block per resource; each block ends with `.` on its own line.
- Use placeholders: `data5g:CO__ID_CONDITION_SUST_*__`, `data5g:SE__ID_SUSTAINABILITY_1__`, `data5g:RE__ID_REPORTING_SUSTAINABILITY_1__`.
- **Reuse** `sharedCxLocal` from draft context — reference it in SE `log:allOf` only; do not emit a second `CX` block when `sharedCxLocal` is set.

Emit:
1. One `data5g:CO… a icm:Condition` per sustainability catalogue entry from runtime (`sustainability[]`).
2. `data5g:SE… a data5g:SustainabilityExpectation, icm:Expectation, icm:IntentElement` with `icm:target data5g:sustainability`, `log:allOf` listing sustainability CO block(s) and shared `CX…`.
3. `data5g:durationSustainability_CO… a time:DurationDescription` and scoped report event class.
4. `icm:ObservationReportingExpectation` targeting `data5g:sustainability` with prometheus destinations/triggers.

Example shape (separate blocks, semicolon before `time:` on SE):

```
data5g:CO__ID_CONDITION_SUST_1__ a icm:Condition ; ... .

data5g:SE__ID_SUSTAINABILITY_1__ a data5g:SustainabilityExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:sustainability ;
    log:allOf data5g:CO__ID_CONDITION_SUST_1__, data5g:CX__ID_CONTEXT_1__ ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:durationSustainability_CO__ID_CONDITION_SUST_1__ a time:DurationDescription ; ... .

data5g:TenMinuteReportEventSustainability_CO__ID_CONDITION_SUST_1__ a rdfs:Class ; ... .

data5g:RE__ID_REPORTING_SUSTAINABILITY_1__ a icm:ObservationReportingExpectation ; ... .
```
