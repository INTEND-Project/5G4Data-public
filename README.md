# Intent-Lifecycle-Management
Documentation and code examples for Intent Lifecycle Management. This work is conducted as part of the EU funded INTEND project.

***Description of subfolders in this repo:***

**src/BusinessLevelAgent:**
This folder contains a very simplistic PoC for the first step of the lifecycle management of intents. In the INTEND architecture, this step will be handled by inChat. The main goal in this step is to transform a natural language expressed statement from a customer to a formal TM Forum formatted Intent description (following v.3.6.0 of the TM Forum Intent ontology).

**src/Intent-Management-API-TMF921:**
This folder contains an implementation of the TMF921 API for intent management. Note that only the parts we need for the 5G4DATA open control loop Minimal Viable Scenario has been implemented. So far, only these parts of the API has been implemented:
| route     | HTTP method   | Description  |
|-----------|---------------|--------------|
| intent    | POST          |Create an intent (i.e. intent owner uses this route to send an intent to an intent handler) |

Note that for the open loop control MVS, this is the only route that is required, but it would probably be benefitial to add some more routes (e.g. ```GET intent, GET intent/{id}, DELETE intent/{id}```, etc.). The ```GET intent, GET intent/{id}``` will make it possible to retrieve (get information about) all intents handled by an intent manager or one specific intent handled by an intent handler. The ```DELETE intent/{id}``` will make it possible to delete an intent that was previously created.

Note also that it could be interesting to experiment with the hub/listener routes to gain experience with the pub/sub mechanisms for reporting that is part of the TMF921 API.

**src/AddIntentReportsToKnowledgeGraph:**
Folder with example program to insert intent report data (simulate) into a knowledge graph.

**src/SlicereportQuestionAnswerAgent:**
A very simple question and answer agent that uses a Large Language Model to allow a user to ask questions related to slice latency measurements in a knowledge graph.

**src/misc:**
Small test programs and other stuff used as part of the work

We have used GraphDB for all our experimentation. GraphDB can be dowloaded [here](https://www.ontotext.com/).