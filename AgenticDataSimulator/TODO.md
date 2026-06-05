# TODO
When the first "working" version of the AgenticDataSimulator was up and running I started to keep a TODO list to structure further work.

# Note
Always move recently closed TODOs to the top of the closed list.

## Open
### Complex TODO´s
- [ ] The simulator PoC is complete in the sense that we can generate both historic and streaming timeseries for all metrics mentioned in an intent´s Conditions. What remains is to handle events, i.e. changes in how the timeseries are generated based on events that inCoord, inSustain and inExplain might initiate (e.g. actions, meaning modification of existing intents or creation of new intents). We need to discuss this...
- [ ] The different tools (inCoord, inSustain, inExplain) may have requirements on how the timeseries needs to be created that is currently not supported. We need to include support for those requirements both in scripts (extend the DSL, add support for freetext key words, etc.) and in the SimulatorAgentPackages/5g4data-intent-observations agent package. Support in the agent can be implemented using more prompt modules (e.g SimulatorAgentPackages/5g4data-intent-observations/prompt_modules), as code (parse keywords in structured and freetext used in "request observation-report ..." commands in scripts and add code to support it), as refinements of the agent SKILL.md file, as agent tools, etc.
- [ ] The PoC intent agent is good since we enforce determinism in many ways, but the observation agent probably needs improvement along many lines.... Having a good observation generating agent is very important... Maybe partners have insight that could help creating good observation generating agents? This is linked to the TODO item above, but even more holistic.
- [ ] Add status report agent (or should the observation agent do that based on observed metrics?)
- [ ]  Remove the agent sidecar API, and use only A2A to comunicate with agents to ensure A2A conformance for our agents. Reflect over if it is possible, the progress bar (GET …/observation-progress?intentId=…) and observation errors (GET …/observation-errors) might be a challenge....
- [ ] Full separation of dev and prod (today they use the same GraphDB, Prometheus and agents). Not sure if we neeed this, but could be good...

### Easy TODO´s?

- [ ] Although the turtle is now better in the Controller, it still shows blank nodes...
- [ ] Change the intent generating agent to support the format (with CoordinationExpectation and utility functions) that inCoord expects.
- [ ] Add functionality for the About/Help button
- [ ] Dockerize the Controller (not sure, maybe eventually, but development is easier without)

## Closed
- [x] When Prometheus base URL is set in the Controller all services needs to use it. Still needs testing...
- [x] The old Intent-Simulator wiped the entire repository when I clicked "Delete all intents" button, including the infrastructure graph and the TIO ontology.... Get it back and fix the Intent-Simulator...
- [x] Make the turtle in the "Test send" window readable. The Intent-Simulator creates more readable turtle, make it similar in the Controller.
- [x] Make the sections in the panels "collapsable"
- [x] The sections in the right and left panel goes ouside the panel width on panel resize. Fix it (by makeing the elements smaller when size decreases beyond inner items min size).
- [x] Make it possible to select the model and the temperature for an agent. Add a configure icon for each agent in the agent list and when clicked, popup a settings window where the model name and temperature can be set. Available models can be selected from a list. The list should be generated using the OpenAI API (https://api.openai.com/v1/models).
- [x] Add to SimulatorController that an intent can be sent to inSustain, inCoord or inExplain the same way ../inServ sends intents (TMF921). in the SimulatorController GUI, add a "Tools" section in the right panel where the tools inSustain, inCoord and inExplain is listed. For each tool in the list, add a "Settings" icon that when clicked pop ups a window that allows the user to set the URL for the tool and a "Send" icon that when clicked pop ups a window where an intent can be selected. The intents are stored in GraphDB and the list should be populated using a SPARQL query to get the intents from the selected repository (KG target). 
- [x] Share as is not working anymore? Cookie problem between dev and prod.
- [x] Send Ericsson/Mario description of how the metadata query thingy works.
- [x] Add a progress bar per metric that is being generated. For long historic timeseries with 100K++ tics the generation takes a long time and the user needs some sort of feedback.
- [x] For long timeseries the Grafana dashboard is not showing data, fix it. It was related to how the url timeframe for the grafana dashboard was constructed.
- [x] Give an error message when the number of ticks to be generated is above the SYNTH_OBS_HISTORIC_MAX_POINTS threshold. Also add checking of this to dry-run.
- [x] Start the data generation scripts in background to get fast feedback?
- [x] Hide the "Agent assistant" section in the left panel (we might unhide it later, so let us not remove the code yet). When "Show metrics" button is clicked, show the metrics in the right panel under a new heading "Metric stems".
- [x] We need to serve Grafana over https on a remotely reachable URL. It now uses a port number and as a result we need to update the ufw to allow remote users to reach Grafana. Change so that the base URL is https://start5g-1.cs.uit.no/grafana Make needed changes in the Caddyfile.
- [x] "Show metrics" button action only reports what is in the helm chart values.yaml file and not what could be result of network expectations. Find a way to fix this.
- [x] Reflect over what the impact of allowing external partners to use their own Prometheus to store observation report values for metrics (and to populate it with real data from a deployment to their own Kubernetes cluster). The Query in GraphDB does only hold the query, not the URL to where the query should be sent. Should the URL be stored as well?
- [x] Open up for API access to GraphDB so that partners can access our GraphDB server. Add security and basic authorisation before we allow access. 
- [x] Grafana sometimes has timeframe set to 3h-now for historic generated data. Fix it.
- [x] Let list items in the Intents list be yellow until the generation of data is complete. When it is complete, change the color to green. Do not allow the user to click on the Grafana button until all data has been succesfully written to Prometheus (or GraphDB,depending on the storage type selected).
- [x] Make it possible to resize the "Run script log" window.
- [x] Do not allow running of scripts while data in Prometheus or the KG is being deleted since it may result in new data being wiped out or blocked for writing. If user tries to click "Run Script": popup a message to wait until deletion is completed.
- [x] Add "Delete selected log" and a "Delete all run script logs" trashcan icons next to "Show selected logs". Ask for confirmation (stating that either the selected log or all logs will be deleted).
- [x] Check that metadata is present for sustainability metrics
- [x] Fix bug in the intent list, old intents are still showing after KG clearing.
- [x] Add a button in the controller that shows the metrics for the workload that would be selected by the "create intent" command.
- [x] Add a dev version for further development on a different port so that the prod version does not go up/down for users all the time during development
- [x] Add to the workload catalogue the posibility to view the metric names for the objectives and sustainability part of the values.yaml file. This will make it easier to see what the metric names in the request commands should be.
- [x] Configure so that all services needed will restart when server reboots (use --restart unless-stopped for all containerized services and systemd setup for non containerized services)
- [x] Move the log selector and "Show selected log" to the "Script editor" panel
- [x] It is not obvious that it is possible to change the size of the different panels or scroll sideway to see all button/icons. Maybe also add the possibility to hide panels to make more room?
- [x] The agent registry does not seem to detect health/uptime for agents after we added authentication.Could be a problem related to the new key based authentication scheme that we added.
- [x] The direct interaction with an agent from the a2a-registry fails, probably because it does not use the key. Needs to be fixed (not vital, but nice to demo).
- [x] Users need a Grafana user to view the dashboards. Create a seamless transition from SimulatorController to Grafana.
- [x] Sort the scipt list alfabetically as default, but make it possible to sort based on when it was created (newest first)
- [x] When a user creates a KG, update the "Knowledge graph target" selection imediately to select it as the target and update the GUI so that it is visible without a refresh of the browser window.
- [x] Make the delete buttons for GraphDB and Prometheus user specific
- [x] When clicking the "Delete script" button/icon in the list of scripts the list should be updated after the deletion.
- [x] Make it mandatory to create a KG before any scripts are executed
- [x] Give an understandable error message when password is to short when creating a new user.
- [x] Improve isolation between users:
  - Add persistent storage (server side) of script run logs per user (store only the 10 last runs)
  - Track userid/intentId when scripts are executed and only list intents that were created by the current user in the Intents list panel
  - Include user id or username in created repository/graph names
- [x] Add visability of shared scripts
  - Add a "Share" button next to "Save As" button. When this button is used, the script will be visible for all users. When user hovers over the button, explain the semantics.
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


