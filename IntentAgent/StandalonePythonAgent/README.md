# StandalonePythonAgent

Standalone Python implementation of the 5G4Data intent-authoring agent. It replaces Anthropic Managed Agents with:
- a local FastAPI service
- an OpenAI- or Claude-backed agent core
- a CLI chat client that talks to the local API

The agent behavior is derived from the managed-agent skill and response policy:
- `../Antrophic Claude Managed Agent/SKILL.md`
- `../Antrophic Claude Managed Agent/SYSTEM_PROMPT.md`

## Features

- Interactive chat CLI and one-shot mode
- Local in-memory sessions exposed via HTTP
- OpenAI and Claude API integration
- Explicit adapters for:
  - workload catalogue lookups
  - GraphDB/SPARQL queries
  - ontology and example-intent file access

## Project layout

```text
StandalonePythonAgent/
  pyproject.toml
  .env.example
  src/
    main.py
    standalone_python_agent/
      agent.py
      api.py
      cli.py
      config.py
      models.py
      prompting.py
      tools/
        catalogue.py
        graphdb.py
        ontology.py
```

## Setup

From the repo root:

```bash
cd "IntentAgent/StandalonePythonAgent"
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

Set the required environment variables:

```bash
export ONTOLOGY_ROOT="../5G4Data-private/TM-Forum-Intent-Toolkit/TMForumIntentOntology"
export EXAMPLE_INTENTS_ROOT="../Intent-Simulator/intents"
```

If a `.env` file exists in `IntentAgent/StandalonePythonAgent/`, it is loaded automatically on startup. Shell environment variables still take precedence.

Choose one provider:

OpenAI:

```bash
export LLM_PROVIDER=openai
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-4o-mini"
```

Claude:

```bash
export LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY="..."
export ANTHROPIC_MODEL="claude-3-5-sonnet-latest"
```

Optional variables:

- `LLM_PROVIDER` default: `openai`
- `OPENAI_MODEL` default: `gpt-4o-mini`
- `OPENAI_BASE_URL` for future OpenAI-compatible endpoints
- `ANTHROPIC_MODEL` default: `claude-3-5-sonnet-latest`
- `ANTHROPIC_BASE_URL`
- `WORKLOAD_CATALOG_BASE_URL`
- `GRAPHDB_ENDPOINT`
- `GRAPHDB_NAMED_GRAPH`
- `SKILL_FILE`
- `SYSTEM_PROMPT_FILE`

## Run the API

```bash
cd "IntentAgent/StandalonePythonAgent"
source .venv/bin/activate
pip install -e .
standalone-python-agent-api
```

Health check:

```bash
curl -s http://127.0.0.1:8010/health
```

## Run the chat CLI

Interactive mode:

```bash
cd "IntentAgent/StandalonePythonAgent"
source .venv/bin/activate
pip install -e .
standalone-python-agent-chat
```

One-shot mode:

```bash
standalone-python-agent-chat --prompt "I need at least 300 Mbit/s bandwidth and less than 80ms latency for 4K drone video."
```

Reuse an existing session:

```bash
standalone-python-agent-chat --session-id <session_id>
```

## HTTP API

Create a session:

```bash
curl -s -X POST http://127.0.0.1:8010/sessions
```

Send a message:

```bash
curl -s -X POST http://127.0.0.1:8010/sessions/<session_id>/messages \
  -H "Content-Type: application/json" \
  -d '{"text":"Create a network-only intent for 300 Mbit/s bandwidth and under 80 ms latency."}'
```

## Notes

- The first version keeps sessions in memory only.
- The agent uses lightweight orchestration and explicit helper calls instead of a heavyweight framework.
- Tool results are injected into the prompt as structured context.
- If a configured ontology or example path does not exist, the agent continues with reduced grounding and reports that in tool context.
- The OpenAI and Anthropic backends share the same workflow spec and external data adapters, but output style may still vary somewhat by model.
