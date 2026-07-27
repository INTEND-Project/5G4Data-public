import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cloneAgentForPackage } from "../core/agentCloneManager.js";

test("cloneAgentForPackage creates versioned clone and excludes transient folders", () => {
  const root = mkdtempSync(join(tmpdir(), "clone-manager-"));
  const baseline = join(root, "LangGraphAgents");
  mkdirSync(baseline, { recursive: true });
  writeFileSync(join(baseline, ".env"), "LLM_PROVIDER=openai\n", "utf8");
  writeFileSync(join(baseline, "README.md"), "baseline\n", "utf8");
  mkdirSync(join(baseline, "node_modules"), { recursive: true });
  writeFileSync(join(baseline, "node_modules", "ignored.txt"), "ignore\n", "utf8");

  const first = cloneAgentForPackage({ baselineAgentDir: baseline, packageName: "pkg-a" });
  assert.equal(first.version, 1);
  assert.match(first.cloneDir, /agents\/pkg-a$/);
  const firstReadme = readFileSync(join(first.cloneDir, "README.md"), "utf8");
  assert.equal(firstReadme.trim(), "baseline");
  assert.throws(() => readFileSync(join(first.cloneDir, "node_modules", "ignored.txt"), "utf8"));

  const second = cloneAgentForPackage({ baselineAgentDir: baseline, packageName: "pkg-a" });
  assert.equal(second.version, 2);
  assert.match(second.cloneDir, /agents\/pkg-a-v2$/);
});

test("cloneAgentForPackage uses exact path when iterationLabel is set", () => {
  const root = mkdtempSync(join(tmpdir(), "clone-manager-iter-"));
  const baseline = join(root, "LangGraphAgents");
  mkdirSync(baseline, { recursive: true });
  writeFileSync(join(baseline, "README.md"), "baseline\n", "utf8");

  const clone = cloneAgentForPackage({
    baselineAgentDir: baseline,
    packageName: "5g4data-intent-mistral-small4-langgraph-generating-agent",
    iterationLabel: "i1"
  });
  assert.match(
    clone.cloneDir,
    /agents\/5g4data-intent-mistral-small4-langgraph-generating-agent-i1$/
  );

  assert.throws(() =>
    cloneAgentForPackage({
      baselineAgentDir: baseline,
      packageName: "5g4data-intent-mistral-small4-langgraph-generating-agent",
      iterationLabel: "i1"
    })
  );
});

test("cloneAgentForPackage uses package folder name under agents/", () => {
  const root = mkdtempSync(join(tmpdir(), "clone-manager-folder-name-"));
  const baseline = join(root, "LangGraphAgents");
  mkdirSync(baseline, { recursive: true });
  writeFileSync(join(baseline, "README.md"), "baseline\n", "utf8");

  const clone = cloneAgentForPackage({
    baselineAgentDir: baseline,
    packageName: "5g4data-intent-langgraph-generating-agent"
  });
  assert.match(clone.cloneDir, /agents\/5g4data-intent-langgraph-generating-agent$/);
});
