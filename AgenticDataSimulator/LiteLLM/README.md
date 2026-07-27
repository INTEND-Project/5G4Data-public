# LiteLLM proxy for Bedrock (Ericsson SSO)

Local OpenAI-compatible proxy in front of AWS Bedrock, using SSO credentials from `~/.aws/sso/cache`. The simulator agents talk OpenAI to this proxy on `127.0.0.1:4000`; the proxy SigV4-signs requests to Bedrock.

This is one **example** of a local LLM backend for the simulator — nothing here is specific to it. Any OpenAI-compatible endpoint works: point the agents' `OPENAI_BASE_URL` / `OPENAI_API_KEY` at your own provider and skip this stack entirely. It exists so the simulator can be run without access to a partner-hosted model endpoint.

## First-time setup

1. `cp .env.example .env` and fill in `LITELLM_MASTER_KEY`, `AWS_PROFILE`, `AWS_REGION`.
2. Confirm your SSO profile works: `aws sts get-caller-identity --profile "$AWS_PROFILE"`.
3. `docker network create mlflow-network 2>/dev/null || true` — the shared network the agents also attach to.
4. `docker compose up -d`
5. `curl -sf http://127.0.0.1:4000/health/liveliness` should return 200.

## Daily use

```bash
aws sso login --profile "$AWS_PROFILE"   # refresh SSO token
docker compose up -d                      # if not already running
```

Boto3 re-reads `~/.aws/sso/cache` on each request, so refreshed tokens are picked up automatically — no proxy restart needed.

## Wire the simulator agents to the proxy

After `package load` in `SimulatorAgentKernel`, edit each cloned agent's `.env`:

```
LLM_PROVIDER=openai
OPENAI_BASE_URL=http://litellm-bedrock:4000/v1
OPENAI_API_KEY=<same value as LITELLM_MASTER_KEY>
OPENAI_MODEL=claude-opus-4-8
OPENCLAW_MODEL=claude-opus-4-8
```

`litellm-bedrock` is this stack's `container_name`, resolved by Docker DNS on the shared
`mlflow-network` — so the agents never hop out to a host port. Model names must match a
`model_name` entry in `config.yaml`; add more entries there to expose other Bedrock models.

Then: `./agent-control restart`.

## Security notes

- Proxy binds to `127.0.0.1:4000` only — not reachable from the network.
- Master key required on every request (`Authorization: Bearer …`).
- `~/.aws` mounted read-only into the container.
- `turn_off_message_logging: true` and `LITELLM_LOG=INFO` — prompt/response bodies are not written to disk.
- No third-party observability enabled. All outbound traffic goes to AWS Bedrock only.

## Quick test

```bash
curl -sX POST http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-8","messages":[{"role":"user","content":"ping"}]}'
```
