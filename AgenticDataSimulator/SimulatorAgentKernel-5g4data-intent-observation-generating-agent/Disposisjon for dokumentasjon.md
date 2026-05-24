# Outline of documentation for the multiagent data generation setup

- **Background**: Our phased integration of tools into the 5G4Data use-case (use figures) and the realization that, for the extra functional tools - data is needed.
- **Describe the overall idea**: Create a multiagent system capable of generating simulated data for the 5G4Data use-case at the intent level abstraction.
- **Describe the hypothesis**: Observation of the intent level abstraction is sufficient for the extra functional tools and their integration in the 5G4Data use-case
- **Present the architecture**: Use figure and text
- **Go into idea details**:
  - Agent architecture options (e.g. Antrophic managed agents, Hermes, Standalone (potentially using open source frameworks), OpenClaw etc. Short study through PoC implementations: OpenClaw the winner (mainly due to that it is European and open source, cost and that it seems to fit well)
  - Idea to create generic kernel and plugable packages. Separate the domain specific working of the agent from the core functionality since we want to create many agents. Use skills, promps, rules, validators etc that is packed into a plugable unit (package). The rational is partly to increase deterministic behaviour and increase repeatability.
- **Go into specific agent (packages) details**:
  - Generate intents from natural language
  - Knowledge sources (inGraph/GraphDB for infrastructure knowledge, Workload Catalogue (for knowledge about deployable workloads and their intent and sustainability objectives (aka metrics)) 
  - Generate status reports and observation reports for intents for both Deployment (what IDO/inOrch would generate), Network (what inNet would generate) and Sustainability (what IDO/inOrch would generate) Expectations.
  - Other Agents (e.g. Scripting agent (to script how user and operator intents are generated for specific test scenarios))?
    - User intents are what we have been dealing with so far (e.g. "I want to experiment with a small LLM in Tromsø"), but operator "intents" are here meant to be instructions on how the simulator should act. e.g. "From time t to time t+x generate status and observation reports that intent xyz is not fullfilled"
- **inSustain, inExplain and inCoord integration**: If/when we manage to create a simulator that generates near realistic data, the extrafunctional tools gets access to the "observational twin" data through:
  - SPARQL query (for specific metric) to GraphDB to obtain metadata information about where the detailed metric is stored (GraphDB or Prometheus) and how to access it. How to access it in this context means that the exact query (either SPARQL query if the data is stored in GraphDB or a Prometheus query if the data is stored in Prometheus is returned when the metadata SPARQL query is executed (as described in previous note sent to Ericsson/Mario).
- **Conclusion**:
  - This partly solves the generic problem
    - A clear transition from NL to formally defined intent descriptions (like TM Forum intent ontology) is another part of the generic tool solution.
  -  And partly the discoverability problem we have been discussed before since each agent is a tool in its own right and it is possible to create a description of the agent that an LLM can use to "discover" it  


