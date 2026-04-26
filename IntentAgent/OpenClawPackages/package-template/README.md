# package-template

Starter template for creating a new OpenClaw domain package.

## How to use

1. Copy this folder to a new package name.
2. Update `manifest.json` (`name`, versions, and file references if needed).
3. Replace `skills/SKILL.md`, prompts, rules, validators, and tool bindings with domain-specific content.
4. Optionally add postprocessors (`manifest.json` `postprocessors` + `validators/postprocessors.json` + modules).
5. Load with:

```bash
npx tsx src/index.ts package load ../OpenClawPackages/<your-package-name>
```
