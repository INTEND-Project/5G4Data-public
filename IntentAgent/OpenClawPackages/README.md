# OpenClawPackages

`OpenClawPackages` is the domain package registry used by the generic `OpenClawAgent` kernel.

Each subfolder in this directory is a self-contained domain package that defines behavior through configuration, prompts, skills, validators, and optional package tools/postprocessors.

## Why packages exist

The goal is "zero code changes" in the base agent for new domains.

- `OpenClawAgent` stays a generic runtime kernel.
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
cd IntentAgent/OpenClawPackages
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

From `IntentAgent/OpenClawAgent`:

```bash
npx tsx src/index.ts package load ../OpenClawPackages/my-domain-package
```

Or from a `.tgz` archive:

```bash
npx tsx src/index.ts package load /path/to/my-domain-package.tgz
```

This command:

- installs/validates package under `../OpenClawPackages/<package-name>`
- creates a versioned clone `../OpenClawAgent-<package-name>` (or `-v2`, `-v3`, ...)
- copies package tools into cloned `src/tools/`
- updates cloned `.env` to point to package `DOMAIN_PACKAGE_DIR` and `SKILL_FILE`

## Current packages

- `5g4data-intent-generation`: production package for TM Forum intent generation.
- `package-template`: starter scaffold for new domain packages.
