# Intent-Lifecycle-Management
Documentation and code examples for Intent Lifecycle Management. This work is conducted as part of the EU funded INTEND project.

***Description of subfolders in this repo:***

**src/BusinessLevelAgent:**
This folder contains a very simplistic PoC for the first step of the lifecycle management of intents. In the INTEND architecture, this step will be handled by inChat. The main goal in this step is to transform a natural language expressed statement from a customer to a formal TM Forum formatted Intent description (following v.3.6.0 of the TM Forum Intent ontology).

**src/AddIntentReportsToKnowledgeGraph:**
Folder with example program to insert intent report data (simulate) into a knowledge graph.

**src/SlicereportQuestionAnswerAgent:**
A very simple question and answer agent that uses a Large Language Model to allow a user to ask questions related to slice latency measurements in a knowledge graph.

**src/misc:**
Small test programs and other stuff used as part of the work

We have used GraphDB for all our experimentation. GraphDB can be dowloaded [here](https://www.ontotext.com/).