import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cloneAgentForPackage } from "../core/agentCloneManager.js";

test("cloneAgentForPackage creates versioned clone and excludes transient folders", () => {
  const root = mkdtempSync(join(tmpdir(), "clone-manager-"));
  const baseline = join(root, "OpenClawAgent");
  mkdirSync(baseline, { recursive: true });
  writeFileSync(join(baseline, ".env"), "LLM_PROVIDER=openai\n", "utf8");
  writeFileSync(join(baseline, "README.md"), "baseline\n", "utf8");
  mkdirSync(join(baseline, "node_modules"), { recursive: true });
  writeFileSync(join(baseline, "node_modules", "ignored.txt"), "ignore\n", "utf8");

  const first = cloneAgentForPackage({ baselineAgentDir: baseline, packageName: "pkg-a" });
  assert.equal(first.version, 1);
  const firstReadme = readFileSync(join(first.cloneDir, "README.md"), "utf8");
  assert.equal(firstReadme.trim(), "baseline");
  assert.throws(() => readFileSync(join(first.cloneDir, "node_modules", "ignored.txt"), "utf8"));

  const second = cloneAgentForPackage({ baselineAgentDir: baseline, packageName: "pkg-a" });
  assert.equal(second.version, 2);
  assert.match(second.cloneDir, /-v2$/);
});
