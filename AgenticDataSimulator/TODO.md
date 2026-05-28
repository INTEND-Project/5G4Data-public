# TODO
When the first "working" version of the AgenticDataSimulator was up and running I started to keep a TODO list to structure further work.

## Open
### Complex TODO´s
- [ ] The simulator PoC is complete in the sense that we can generate both historic and streaming timeseries for all metrics mentioned in an intent´s Conditions. What remains is to handle events, i.e. changes in how the timeseries are generated based on events that inCoord, inSustain and inExplain might initiate (e.g. actions, meaning modification of existing intents or creation of new intents). We need to discuss this...
- [ ] The different tools (inCoord, inSustain, inExplain) may have requirements on how the timeseries needs to be created that is currently not supported. We need to include support for those requirements both in scripts (extend the DSL, add support for freetext key words, etc.) and in the SimulatorAgentPackages/5g4data-intent-observations agent package. Support in the agent can be implemented using more prompt modules (e.g SimulatorAgentPackages/5g4data-intent-observations/prompt_modules), as code (parse keywords in structured and freetext used in "request observation-report ..." commands in scripts and add code to support it), as refinements of the agent SKILL.md file, as agent tools, etc.

### Easy TODO´s?
- [ ] Dockerize the Controller

## Closed

- [x] Add Grafana integration: The intent list now under Prometheus in the right panel should be listed separately from Prometheus (since we can also store in GraphDB, and later maybe in InFluxDB or other storage options). I.e. add a "Intents" header. For each intent under the "Intents" header, add a Grafana button (use small grafana icon) and either a "delete in Prometehus" or "delete in GraphDB", depending on where the data is stored.
- [x] Add quantifier in values.yaml for workloads to asure that conditions are formed correct? e.g: 
*objectives:
    name: p99-token-target
    value: 0.0
    tmf-value-hint: "400"
    tmf-quantifier-hint: "quan:larger"
    measuredBy: intend/p99token*
- [x] Check if there is code in the controller that uses specific metric names to implement functionality and create a plan to remove them without reducing functionality.
- [x] Improve the observation generating agent to create better timeseries. First iteration done, probably needs more...
- [x] Fix the "Delete in Prometheus" funtionality (implies a brief stop of Prometheus)
- [x] Fix the threshold values and colored areas in the Grafana dashboard. Add a Grafana folder holding the dashboards used.
- [x] Improve Controller GUI sluginess (polling GraphDB to update intent list is costly and makes the GUI less responsive, make it lighter)
- [x] Make the Grafana dashboards use the selected KG in the Controller.
- [x] Update the IntentReportQueryProxy API to Accepts repository_id (or repository) on /api/get-metric-reports/<metric_name> (i.e. /api/get-metric-reports/${metric_name}?repository_id=${repository_id}&start=...)
- [x] Add support of the old API style (without repository_id in the URL) in the Proxy for backward compatibility
- [x] Move the IntentReportQueryProxy (the link between Grafana and GraphDB/Prometheus) to AgenticDataSimulator
