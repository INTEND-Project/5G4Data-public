# Intent-Lifecycle-Management
Documentation and code examples for Intent Lifecycle Management. This work is conducted as part of the EU funded INTEND project.

***Description of subfolders in this repo:***

**src/BusinessLevelAgent:**
This folder contains a very simplistic PoC for the first step towards lifecycle management of intents. In the INTEND architecture, this step will be handled by inChat. The main goal in this step is to transform a natural language expressed statement from a customer to a formal TM Forum formatted Intent description (following v.3.6.0 of the TM Forum Intent ontology).

**src/Intent-Management-API-TMF921:**
This folder contains an implementation of the TMF921 API for intent management. Note that only the parts we need for the 5G4DATA open control loop Minimal Viable Scenario will be implemented. So far, only the routes marked with a green dot (🟢) in the **OK** cell in the table below has been implemented:
|<div style="width:25px">OK</div>|<div style="width:40px">route</div>|HTTP method|<div style="width:300px">Description</div>|
|------|---------------|-------|--------------|
| 🟢 | /intent          | GET    | List or find Intent objects |
| 🟢 | /intent          | POST   | Create an Intent |
| 🟢 | /intent/{id}     | GET    | Retrieve an Intent by ID |
| 🟢 | /intent/{id}     | PATCH  | Partially update an Intent entity |
| 🟢 | /intent/{id}     | DELETE | Delete an Intent entity |
| 🔴 | /intent/{intentId}/intentReport | GET    | List or find IntentReport objects |
| 🔴 | /intent/{intentId}/intentReport/{id} | GET    | Retrieve an IntentReport by ID |
| 🔴 | /intent/{intentId}/intentReport/{id} | DELETE | Delete an IntentReport entity |
| 🔴 | /intentSpecification | GET    | List or find IntentSpecification objects |
| 🔴 | /intentSpecification | POST   | Create an IntentSpecification |
| 🔴 | /intentSpecification/{id} | GET    | Retrieve an IntentSpecification by ID |
| 🔴 | /intentSpecification/{id} | PATCH  | Partially update an IntentSpecification entity |
| 🔴 | /intentSpecification/{id} | DELETE | Delete an IntentSpecification entity |
| 🔴 | /hub              | POST   | Create a subscription (hub) to receive Events |
| 🔴 | /hub/{id}        | DELETE | Remove a subscription (hub) to receive Events |
| 🔴 | /listener/* | POST | Client listener for misc (*) event types, see the TMF921 for more details |


Note that for the open loop control MVS, the POST/intent is the only route that is required, but it would probably be benefitial to add some more routes (e.g. ```GET/intent, GET/intent/{id}, DELETE/intent/{id}```, etc.).

Note also that it could be interesting to experiment with the hub/listener routes to gain experience with the pub/sub mechanisms for reporting that is part of the TMF921 API.

**src/CreateIntent:**
This folder contains a client program (intent owner TMF921 API stub) that sends a turtle formatted intent (formatted according to the TM Forum Intent ontology)  to an intent manager. The intent manager will return a confirmation that the intent is received. There is also a subfolder with a couple of turtle formatted intents relevant for the 5G4DATA use-case.

**src/AddIntentReportsToKnowledgeGraph:**
Folder with example program to insert intent report data (simulate) into a knowledge graph.

**src/SlicereportQuestionAnswerAgent:**
A very simple question and answer agent that uses a Large Language Model to allow a user to ask questions related to slice latency measurements in a knowledge graph.

**src/misc:**
Small test programs and other stuff used as part of the work

We have used GraphDB for all our experimentation. GraphDB can be dowloaded [here](https://www.ontotext.com/).