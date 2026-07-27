# Outline of documentation for the multiagent data generation setup

Updated to match the **current lab implementation** (2026-07). Use this as a writing outline; detailed facts live in the sibling markdown files in this folder.

- **Background**: Phased integration of tools into the 5G4Data use-case and the need for data for extra-functional tools (inCoord, inSustain, inExplain).
- **Overall idea**: Multiagent system that generates simulated data at the intent abstraction level (intents + observation reports; status reports as capabilities evolve).
- **Hypothesis**: Observation of the intent-level abstraction is sufficient for those tools’ integration in the 5G4Data use-case.
- **Architecture (current)**:
  - Kernels: `SimulatorAgentKernel`, optional `SimulatorAgentKernel-mistral.small4`, side-by-side `LangGraphAgents`
  - Packages: `SimulatorAgentPackages/` and `LangGraphAgents/packages/`
  - Clones: `agents/<package-name>/` via `package load`
  - Controller: SimulatorController (:3000 / :3001), script DSL, preferred agents
  - Discovery: A2A registry; public URLs via Caddy `https://start5g-1.cs.uit.no/<agent-card-name>/`
  - Shared observation agent (not one instance per intent)
  - In-memory intent aliases for the script run (GraphDB binding = future)
- **Agent / package details**:
  - Intent generation from NL (stock, mistral-small4 fragmented, LangGraph variants)
  - Knowledge: GraphDB infrastructure KG, Workload Catalogue objectives/metrics
  - Observation reports for Deployment / Network / Sustainability expectations → GraphDB and/or Prometheus
  - Operator-style controls via observation-agent A2A + progress APIs
- **Extra-functional tool integration**: Metadata in GraphDB pointing at where detailed metrics live (GraphDB vs Prometheus) and how to query them.
- **Docs map**:
  - `simulator-agent-concept.md` — kernel/package/clone concept
  - `MultiagentDataGenerationSimulator.md` — end-to-end architecture
  - `ARCHITECTURE-client-server-api.md` — APIs, discovery, Caddy
  - `ControllerIntentNameBindingDesign.md` — aliases (current + future GraphDB)
  - `ReportingAgentDiscovery.md` — observation discovery/routing
  - `LangGraphAgents/docs/CONTROLLER_CUTOVER.md` — LangGraph-specific cutover
- **Conclusion sketch**:
  - Partly solves data generation for the observational twin
  - NL → TM Forum–style intent Turtle remains a core capability
  - Agents are discoverable tools via A2A cards; Controller scripts compose them
