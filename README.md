# Intent-Lifecycle-Management
Documentation and code examples for Intent Lifecycle Management. This work is conducted as part of the EU funded INTEND project.

***Description of subfolders in this repo:***

**src/BusinessLevelAgent:**
This folder contains a very simplistic PoC for the first step of the lifecycle management of intents. In the INTEND architecture, this step will be handled by inChat. The main goal in this step is to transform a natural language expressed statement from a customer to a formal TM Forum formatted Intent description (following v.3.6.0 of the TM Forum Intent ontology).

**src/Intent-Management-API-TMF921:**
This folder contains an implementation of the TMF921 API for intent management. Note that only the parts we need for the 5G4DATA open control loop Minimal Viable Scenario will be implemented. So far, only the routes marked with a green dot (🟢) in the **Status** cell in the table below has been implemented:
|<div style="width:25px">OK</div>|route|HTTP method|<div style="width:300px">Description</div>|
|------|---------------|-------|--------------|
| 🔴 | intent          | GET    |List or find Intent objects |
| 🟢 | intent          | POST   |Create an intent (i.e. intent owner uses this route to send an intent to an intent handler) || 🔴 | /intent/{id}   | GET          |List or find Intent objects |
| 🔴 | /intent/{id}    | GET    |Retrieves an Intent by ID |
| 🔴 | /intent/{id}    | PATCH  |This operation updates partially a Intent entity. |
| 🔴 | /intent/{id}    | DELETE |This operation updates partially a Intent entity. |

This operation deletes a Intent entity.
Note that for the open loop control MVS, this is the only route that is required, but it would probably be benefitial to add some more routes (e.g. ```GET intent, GET intent/{id}, DELETE intent/{id}```, etc.). The ```GET intent, GET intent/{id}``` will make it possible to retrieve (get information about) all intents handled by an intent manager or one specific intent handled by an intent handler. The ```DELETE intent/{id}``` will make it possible to delete an intent that was previously created.

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