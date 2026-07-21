#!/usr/bin/env node
/**
 * Smoke: load intent package via runtime and run one turn.
 * Set LANGSMITH_TRACING=true and LANGSMITH_API_KEY to verify traces in LangSmith UI.
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prompt =
  process.argv[2] ??
  "I want to experiment with a small llm in a datacenter near Tromsø/Norway";

const env = {
  ...process.env,
  DOMAIN_PACKAGE_DIR: resolve(root, "packages/5g4data-intent-langgraph-generating-agent"),
  SKILL_FILE: resolve(root, "packages/5g4data-intent-langgraph-generating-agent/skills/SKILL.md"),
  SHACL_SHAPES_FILE: resolve(
    root,
    "packages/5g4data-intent-langgraph-generating-agent/validation/skill_subset_intent_shapes.ttl"
  ),
  API_SERVER_ENABLED: "false",
  A2A_ENABLED: "false",
  NO_GRAPHDB: "true"
};

console.log("[smoke] running one-shot turn (NO_GRAPHDB=true)…");
const result = spawnSync(
  "npx",
  ["tsx", "src/index.ts", "--debug", "--noGraphDB", prompt],
  { cwd: root, env, encoding: "utf8", stdio: "inherit" }
);
process.exit(result.status ?? 1);
