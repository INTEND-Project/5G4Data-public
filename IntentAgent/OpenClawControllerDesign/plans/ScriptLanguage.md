# Controller Script Language (Draft Specification)

This document defines a documentation-level DSL for an orchestration controller that:

- discovers A2A agents from a registry,
- creates intents through a domain-specific intent agent,
- controls status-report generation through domain-level reporting agents, and
- controls observation-report generation through domain-level reporting agents.

The DSL is intentionally small and human-readable. It captures script behavior and expected bindings, but does not define parser/runtime implementation details.

## 1) Assumptions

- Agent discovery uses an A2A-style registry with agent cards.
- Required agents for a given domain are already running and registered.
- Some status/observation control flows may spawn specialized per-intent agents; those agents can also be discovered through the same registry.

## 2) Core Entities and Bindings

- `agentRef`: symbolic reference to a discovered agent card (endpoint and metadata).
- `intentAlias`: logical script-local name for an intent (for example `avalanche-object-detection-intent`).
- `intentId`: concrete identifier returned by an intent generation agent.
- `sessionRef`: script-local name for state returned by a report-generation request (for example URL/handle for later control).

Binding rules:

- A successful `create intent` statement MUST bind `intentAlias -> intentId`.
- Any statement that accepts `<intentAlias|intentId>` MUST resolve aliases to concrete `intentId` before the outgoing request.
- `agentRef` and `sessionRef` values are immutable once bound in a script run.
- Status and observation agent discovery is domain-scoped; intent scoping starts when a `request ... for <intentAlias|intentId>` statement is sent.

## 3) Script Structure

Scripts are ordered lists of statements. Execution is sequential.

- Empty lines are allowed.
- Lines starting with `#` are comments.
- String values are quoted with double quotes.

## 4) Statement Catalog

### 4.1 Discovery statements

Discover an intent-generation agent for a domain:

`discover intent-agent by domain <domain> as <agentRef>`

Discover a status-report-capable agent for a domain:

`discover status-agent by domain <domain> as <agentRef>`

Discover an observation-report-capable agent for a domain:

`discover observation-agent by domain <domain> as <agentRef>`

### 4.2 Intent generation

Create an intent by sending control input (prompt) to the discovered intent agent:

`create intent using <agentRef> prompt "<prompt>" as <intentAlias>`

Expected response includes status and `intentId`. On success, the controller stores:

`<intentAlias> -> <intentId>`

### 4.3 Status reporting control

Request status report generation for a resolved intent:

`request status-report using <agentRef> for <intentAlias|intentId> instructions "<instructions>" as <sessionRef>`

Expected response may include a URL/handle for further control of a specialized per-intent status agent, bound to `<sessionRef>`. This request is the step that applies intent-specific context to an already discovered domain-level status agent.

### 4.4 Observation reporting control

Request observation report generation for a resolved intent:

`request observation-report using <agentRef> for <intentAlias|intentId> instructions "<instructions>" as <sessionRef>`

Expected response may include a URL/handle for further control of a specialized per-intent observation agent, bound to `<sessionRef>`. This request is the step that applies intent-specific context to an already discovered domain-level observation agent.

## 5) Error and Edge Behavior (Spec-Level)

- Unknown alias: using an undefined `intentAlias` is a script error.
- Discovery miss: if no matching agent card is found, the statement fails.
- Discovery ambiguity: if multiple agents match and no tie-break rule is provided, the statement fails as ambiguous.
- Agent call failure: non-success status from a control request fails the statement and stops execution unless future runtime policy says otherwise.

## 6) Requirement Coverage

This DSL covers the required capabilities:

- Discovery by domain for intent-generating agents.
- Discovery by domain for observation-reporting agents.
- Discovery by domain for status-reporting agents.
- Sending control messages to the intent generator and receiving status + `intentId`.
- Using logical names (`intentAlias`) and resolving to concrete `intentId` for later report operations.
- Sending first control messages that make status/observation flows intent-specific and capturing returned endpoint/handle data for later use.
