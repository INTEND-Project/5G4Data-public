# IntentAgent Managed Agent Workflow

This folder contains scripts and skill files for creating, updating, and chatting with a Claude Managed Agent for TM Forum intent authoring.

All commands below assume your current working directory is `IntentAgent/Antrophic Claude Managed Agent/`.

## Files

- `SKILL.md` - active skill definition used by the managed agent
- `SYSTEM_PROMPT.md` - optional system prompt template for concise intent-only responses
- `create_managed_agent_from_skill.py` - creates or updates the managed agent from `SKILL.md`
- `chat_with_managed_agent.py` - starts a session and runs interactive/one-shot chat

## Prerequisites

- Python environment with `anthropic` and `httpx`
- `ANTHROPIC_API_KEY` set (the Antropic key for access to the Antropic APIs for Managed Agents)
- `GITHUB_TOKEN` set (fine-grained PAT with read access to the ontology repo) to give the Managed Agent access to the complete TM Forum intent ontology

Example:

```bash
export ANTHROPIC_API_KEY="..."
export GITHUB_TOKEN="$(tr -d '\r\n' < ontology-token.txt)"
```

## Network and endpoint setup

Managed Agent runtime could not reach `http://start5g-1.cs.uit.no:3040` directly, so workload catalogue access is routed through HTTPS on port 443 via Caddy.

Configured Caddy routes:

- `https://start5g-1.cs.uit.no/wcatalog/*` -> host `:3040` (workload catalogue app)
- `https://start5g-1.cs.uit.no/wchartmuseum/*` -> host `:8080` (associated ChartMuseum API)

`SKILL.md` use the API over https (through Caddy):

- Base URL: `https://start5g-1.cs.uit.no/wchartmuseum`
- Endpoints:
  - `/api/charts`
  - `/api/charts/<name>`
  - `/api/charts/<name>/<version>`

## Create a new managed agent

```bash
cd "IntentAgent/Antrophic Claude Managed Agent"
python3 create_managed_agent_from_skill.py
```

Output includes:

- `skill_id`
- `skill_version`
- `agent_id`
- `agent_version`

## Update an existing managed agent
If you change the python script (create_managed_agent_from_skill.py) that sets up the agent or change the SKILL.md file you will have to update the agent.

Use the same `agent_id`:

```bash
python3 create_managed_agent_from_skill.py --agent-id <agent_id>
```

### Enforce concise intent-only responses (system prompt)

The create/update script supports agent-level system prompts:

- `--system-prompt "..."` for inline prompt text
- `--system-prompt-file SYSTEM_PROMPT.md` for versioned prompt text in a file

Recommended update command:

```bash
python3 create_managed_agent_from_skill.py \
  --agent-id <agent_id> \
  --system-prompt-file SYSTEM_PROMPT.md
```

Notes:

- Script uploads/versions the custom skill from `SKILL.md`
- If display title already exists, it creates a new skill version instead of failing
- Script updates agent toolset to ensure `read` is enabled (required for skills)

## Run an interactive or one-shot chat with the managed agent
This is used for testing/debugging). "Normal" interaction (for the simulator architecture) is programatically through the Managed Agent API. 

Interactive:

```bash
python3 chat_with_managed_agent.py --agent-id <agent_id>
```

One-shot:

```bash
python3 chat_with_managed_agent.py --agent-id <agent_id> --prompt "Your prompt here"
```

## Chat script defaults and options

Defaults include:

- rate-limit profile: `free-tier-safe` (the free tier has very strict limits and this needs to be handled)
- ontology repo mount:
  - URL: `https://github.com/arne-munch-ellingsen/INTEND-repo-for-TM-Forum-Intent-Toolkit`
  - branch: `main`
  - mount path: `/workspace/5G4Data-private`

Useful options:

- `--rate-limit-profile free-tier-safe|free-tier-balanced|faster-risky|custom`
- `--turn-timeout-seconds <n>`
- `--github-repo-url <url>`
- `--github-repo-branch <branch>`
- `--github-mount-path <path>`
- `--no-github-resource` (skip repo mount)

## Verify GitHub token access
Can be used to check that the connection to github is working using the created token

```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/arne-munch-ellingsen/INTEND-repo-for-TM-Forum-Intent-Toolkit \
  | rg '"full_name"|"private"|"message"|"status"'
```

Expected on success: `full_name` and `private`, no `Not Found`.

## Session lifecycle and cost control

To inspect sessions:

```bash
curl -s "https://api.anthropic.com/v1/sessions?beta=true&agent_id=<agent_id>&include_archived=false&limit=50" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01"
```

To stop a running session:

```bash
curl -s -X POST "https://api.anthropic.com/v1/sessions/<session_id>/archive?beta=true" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01"
```

## Security notes

- Do not paste tokens in chat or commit them to git.
- If a token was exposed, revoke and recreate it immediately.
- Prefer environment variables for secrets.
