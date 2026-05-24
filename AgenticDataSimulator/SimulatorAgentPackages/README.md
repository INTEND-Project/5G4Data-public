# SimulatorAgentPackages

`SimulatorAgentPackages` is the domain package registry used by the generic `SimulatorAgentKernel` kernel.

Each subfolder in this directory is a self-contained domain package that defines behavior through configuration, prompts, skills, validators, and optional package tools/postprocessors.

## Why packages exist

The goal is "zero code changes" in the base agent for new domains.

- `SimulatorAgentKernel` stays a generic runtime kernel.
- Domain-specific behavior lives in package assets.
- New use cases are created by adding a new package and loading it.

## Package model

A package can define:

- Workflow behavior (`workflow.dsl.json`)
- Classification/context rules (`rules/`)
- Output policy and validation (`validators/`)
- Tool bindings (`tools/bindings.json`)
- Prompt stack (`prompts/`, `prompt_modules/`)
- Skill guidance (`skills/SKILL.md`)
- Optional postprocessors (for example UUID canonicalization)
- Optional support assets (`schemas/`, `examples/`, `tests/`, `mappings/`, etc.)

## Directory layout

Required core files/folders:

- `manifest.json`
- `workflow.dsl.json`
- `rules/`
- `validators/`
- `tools/`
- `prompts/`
- `prompt_modules/`
- `skills/SKILL.md`

Recommended optional files/folders:

- `compatibility.json`
- `checksums.txt`
- `dependencies/`
- `schemas/`
- `validation/`
- `examples/`
- `tests/`
- `mappings/`
- `README.md`

Optional postprocessor wiring:

- add `postprocessors` path in `manifest.json`
- create `validators/postprocessors.json`
- implement modules referenced there (for example `tools/postprocess/*.ts`)

## Create a new package

Start from the template:

```bash
cd AgenticDataSimulator/SimulatorAgentPackages
cp -r package-template my-domain-package
```

Then customize:

1. Update `my-domain-package/manifest.json` (`name`, file paths, optional `postprocessors`).
2. Replace `skills/SKILL.md` with your domain authoring constraints.
3. Update prompts (`prompts/system.md`, `prompt_modules/*`).
4. Configure rules (`rules/classification.json`, `rules/context.json`).
5. Configure validation (`validators/output-policy.json`).
6. Add/adjust tool bindings in `tools/bindings.json`.
7. Add package tools if needed (`tools/*.ts`).
8. Optionally add package postprocessors.

## Load a package into an isolated agent clone

From `AgenticDataSimulator/SimulatorAgentKernel`:

```bash
npx tsx src/index.ts package load ../SimulatorAgentPackages/my-domain-package
```

Or from a `.tgz` archive:

```bash
npx tsx src/index.ts package load /path/to/my-domain-package.tgz
```

This command:

- installs/validates package under `../SimulatorAgentPackages/<package-name>`
- creates a versioned clone `../SimulatorAgentKernel-<package-name>` (or `-v2`, `-v3`, ...)
- copies package tools into cloned `src/tools/`
- updates cloned `.env` to point to package `DOMAIN_PACKAGE_DIR` and `SKILL_FILE`
- builds and starts a Docker container for the clone (`docker compose up -d --build`), unless you pass `--no-container` or set `CONTAINER_LOAD=false`

Skip container startup when Docker is unavailable or for automated tests:

```bash
npx tsx src/index.ts package load --no-container ../SimulatorAgentPackages/my-domain-package
```

## Running multiple clones on one server (HTTP port)

Each clone’s OpenAPI listener uses `API_SERVER_PORT` from `.env` (default in the kernel is `3011`). Package `mappings/env.defaults.json` can set distinct ports per package (e.g. **3011** for generation, **3012** for observations). `package load` publishes that port from the container to the host.

To run on the host without Docker, pass **`--port <n>`** on the clone’s entrypoint (before any one-shot prompt). This overrides `API_SERVER_PORT` for that process only:

```bash
cd ../SimulatorAgentKernel-5g4data-intent-observations
API_SERVER_ENABLED=true npx tsx src/index.ts --port 3013
```

When using containers, set `API_SERVER_PORT` in the clone `.env` before load (or in `mappings/env.defaults.json`) so each compose service gets a unique published port. Manage running clones with `docker compose logs`, `docker compose restart`, etc. from the clone directory.

The same `--port` flag works for host fallback runs. Reverse-proxy paths and `A2A_AGENT_BASE_URL` must still match how clients reach each agent.

`mappings/env.defaults.json` in a package may list GraphDB and other settings for documentation; **`package load` only merges** `A2A_AGENT_BASE_URL`, `A2A_REGISTRY_BASE_URL`, and `API_SERVER_PORT` from that file into the new clone (so baseline `.env` is not overwritten for other keys).

## Current packages

- `5g4data-intent-generation`: production package for TM Forum intent generation.
- `package-template`: starter scaffold for new domain packages.
