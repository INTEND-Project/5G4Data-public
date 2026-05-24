import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureAgentApiKeyForClone, readAgentApiKeysMap, syncAgentApiKeyToConsumers, updateEnvFile, upsertAgentApiKeysEntry } from "../core/envConfigWriter.js";

test("updateEnvFile upserts domain and skill values", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-writer-"));
  const envPath = join(dir, ".env");
  writeFileSync(
    envPath,
    "LLM_PROVIDER=openai\nDOMAIN_PACKAGE_DIR=old\n#comment\nOPENAI_MODEL=test\n",
    "utf8"
  );

  updateEnvFile(envPath, [
    { key: "DOMAIN_PACKAGE_DIR", value: "../SimulatorAgentPackages/package-template" },
    { key: "SKILL_FILE", value: "../SimulatorAgentPackages/package-template/skills/SKILL.md" }
  ]);

  const content = readFileSync(envPath, "utf8");
  assert.match(content, /DOMAIN_PACKAGE_DIR=\.\.\/SimulatorAgentPackages\/package-template/);
  assert.match(content, /SKILL_FILE=\.\.\/SimulatorAgentPackages\/package-template\/skills\/SKILL\.md/);
  assert.match(content, /OPENAI_MODEL=test/);
});

test("ensureAgentApiKeyForClone generates key once and preserves existing key", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-key-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, "LLM_PROVIDER=openai\n", "utf8");

  const first = ensureAgentApiKeyForClone(envPath);
  assert.match(first, /^[0-9a-f]{64}$/);
  const second = ensureAgentApiKeyForClone(envPath);
  assert.equal(second, first);

  updateEnvFile(envPath, [{ key: "AGENT_API_KEY", value: "existing-key" }]);
  const third = ensureAgentApiKeyForClone(envPath);
  assert.equal(third, "existing-key");
});

test("upsertAgentApiKeysEntry merges without dropping existing agents", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-keys-map-"));
  const envPath = join(dir, ".env");
  writeFileSync(
    envPath,
    "DATABASE_URL=file:./dev.db\nAGENT_API_KEYS='{\"existing-agent\":\"old-key\"}'\n",
    "utf8"
  );

  upsertAgentApiKeysEntry(envPath, "new-agent", "new-key");

  const map = readAgentApiKeysMap(envPath);
  assert.deepEqual(map, {
    "existing-agent": "old-key",
    "new-agent": "new-key"
  });
});

test("syncAgentApiKeyToConsumers updates controller and registry env files", () => {
  const root = mkdtempSync(join(tmpdir(), "env-sync-"));
  const baseline = join(root, "SimulatorAgentKernel");
  const controllerEnv = join(root, "SimulatorController", ".env");
  const registryEnv = join(root, "a2a-registry", "backend", ".env");
  mkdirSync(baseline, { recursive: true });
  mkdirSync(join(root, "SimulatorController"), { recursive: true });
  mkdirSync(join(root, "a2a-registry", "backend"), { recursive: true });
  writeFileSync(join(baseline, ".env"), "LLM_PROVIDER=openai\n", "utf8");
  writeFileSync(controllerEnv, "DATABASE_URL=file:./dev.db\n", "utf8");
  writeFileSync(registryEnv, "API_HOST=0.0.0.0\n", "utf8");

  const results = syncAgentApiKeyToConsumers(baseline, "demo-agent", "secret-key");
  assert.equal(results.length, 2);
  assert.equal(results.every((result) => result.updated), true);

  assert.equal(readAgentApiKeysMap(controllerEnv)["demo-agent"], "secret-key");
  assert.equal(readAgentApiKeysMap(registryEnv)["demo-agent"], "secret-key");
});
