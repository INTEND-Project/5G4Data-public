# Controller Script Language Examples

This document provides copy-paste-ready examples for the DSL specified in `ScriptLanguage.md`.

## 1) Minimal exampel (only creates an intent)

```text
# Discover an intent generation agent for the 5g4data domain
discover intent-agent by domain 5g4data as intentGen

# Create an intent and bind alias -> concrete intentId returned by the agent
create intent using intentGen prompt "I am going to use a drone to search for skiers that might have been caught in an avalange near Bodø/Norway. I need an object detection model deployed locally in a sustainable manner and good network connection for sending 4K video to the model in near realtime" as avalanche-object-detection-intent
```

What this demonstrates:

- Domain-based discovery of an intent-generation agent.
- Intent creation with logical alias binding.

## 2) Status Reporting Flow (creates intent and generates status reports)

```text
# Prepare intent
discover intent-agent by domain 5g4data as intentGen
create intent using intentGen prompt "I am going to use a drone to search for skiers that might have been caught in an avalange near Bodø/Norway. I need an object detection model deployed locally in a sustainable manner and good network connection for sending 4K video to the model in near realtime" as avalanche-object-detection-intent

# Discover domain-level status reporting capability
discover status-agent by domain 5g4data as statusControl

# Ask for status reporting with supplementary instructions.
# This first request makes the flow intent-specific.
request status-report using statusControl for avalanche-object-detection-intent instructions "Generate Compliant status report every 5 minutes" as avalancheStatusSession
```

What this demonstrates:

- Domain-scoped discovery of a status reporting agent.
- Resolving `avalanche-object-detection-intent` alias to concrete `intentId` when sending the first status request.
- Capturing returned control URL/handle in `avalancheStatusSession`.

## 3) Observation Reporting Flow

```text
# Prepare intent
discover intent-agent by domain 5g4data as intentGen
create intent using intentGen prompt "I am going to use a drone to search for skiers that might have been caught in an avalange near Bodø/Norway. I need an object detection model deployed locally in a sustainable manner and good network connection for sending 4K video to the model in near realtime" as avalanche-object-detection-intent

# Discover domain-level observation reporting capability
discover observation-agent by domain 5g4data as observationControl

# Ask for observation report generation with supplementary instructions.
# This first request makes the flow intent-specific.
request observation-report using observationControl for avalanche-object-detection-intent instructions "Generate observation reports that are Compliant every minute" as avalancheObservationSession
```

What this demonstrates:

- Domain-scoped discovery of an observation reporting agent.
- Resolving `avalanche-object-detection-intent` alias to concrete `intentId` when sending the first observation request.
- Capturing returned control URL/handle in `avalancheObservationSession`.

## 4) Combined Orchestration (Status + Observation)

```text
# Step 1: Discover and create intent
discover intent-agent by domain 5g4data as intentGen
create intent using intentGen prompt "I am going to use a drone to search for skiers that might have been caught in an avalange near Bodø/Norway. I need an object detection model deployed locally in a sustainable manner and good network connection for sending 4K video to the model in near realtime" as avalanche-object-detection-intent

# Step 2: Discover domain-level reporting agents
discover status-agent by domain 5g4data as statusControl
discover observation-agent by domain 5g4data as observationControl

# Step 3: Status reporting workflow (becomes intent-specific on request)
request status-report using statusControl for avalanche-object-detection-intent instructions "Generate Compliant status report every 5 minutes" as avalancheStatusSession

# Step 4: Observation reporting workflow (becomes intent-specific on request)
request observation-report using observationControl for avalanche-object-detection-intent instructions "Generate observation reports that are Compliant every minute" as avalancheObservationSession
```

What this demonstrates:

- Reusing one `intentAlias` across multiple downstream control flows.
- Domain-level discovery for both status and observation agents.
- A single script orchestrating intent generation and both report-generation channels.

