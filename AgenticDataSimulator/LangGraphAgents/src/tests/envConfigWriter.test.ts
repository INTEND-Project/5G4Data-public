import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyPreservedAgentApiKeyFromEnv,
  ensureAgentApiKeyForClone,
  readAgentApiKeysMap,
  readDotEnvKey,
  syncAgentApiKeyToConsumers,
  syncGraphDbCredentialsToClone,
  updateEnvFile,
  upsertAgentApiKeysEntry
} from "../core/envConfigWriter.js";

test("updateEnvFile upserts domain and skill values", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-writer-"));
  const envPath = join(dir, ".env");
  writeFileSync(
    envPath,
    "LLM_PROVIDER=openai\nDOMAIN_PACKAGE_DIR=old\n#comment\nOPENAI_MODEL=test\n",
    "utf8"
  );

  updateEnvFile(envPath, [
    { key: "DOMAIN_PACKAGE_DIR", value: "./packages/package-template" },
    { key: "SKILL_FILE", value: "./packages/package-template/skills/SKILL.md" }
  ]);

  const content = readFileSync(envPath, "utf8");
  assert.match(content, /DOMAIN_PACKAGE_DIR=\.\/packages\/package-template/);
  assert.match(content, /SKILL_FILE=\.\/packages\/package-template\/skills\/SKILL\.md/);
  assert.match(content, /OPENAI_MODEL=test/);
});

test("applyPreservedAgentApiKeyFromEnv writes key from PRESERVE_AGENT_API_KEY", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-preserve-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, "LLM_PROVIDER=openai\n", "utf8");
  const previous = process.env.PRESERVE_AGENT_API_KEY;
  process.env.PRESERVE_AGENT_API_KEY = "a".repeat(64);
  try {
    applyPreservedAgentApiKeyFromEnv(envPath);
    assert.equal(ensureAgentApiKeyForClone(envPath), "a".repeat(64));
  } finally {
    if (previous === undefined) {
      delete process.env.PRESERVE_AGENT_API_KEY;
    } else {
      process.env.PRESERVE_AGENT_API_KEY = previous;
    }
  }
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
  const baseline = join(root, "LangGraphAgents");
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

test("syncAgentApiKeyToConsumers updates .env.dev when present", () => {
  const root = mkdtempSync(join(tmpdir(), "env-sync-dev-"));
  const baseline = join(root, "LangGraphAgents");
  const controllerEnv = join(root, "SimulatorController", ".env");
  const controllerDevEnv = join(root, "SimulatorController", ".env.dev");
  const registryEnv = join(root, "a2a-registry", "backend", ".env");
  mkdirSync(baseline, { recursive: true });
  mkdirSync(join(root, "SimulatorController"), { recursive: true });
  mkdirSync(join(root, "a2a-registry", "backend"), { recursive: true });
  writeFileSync(join(baseline, ".env"), "LLM_PROVIDER=openai\n", "utf8");
  writeFileSync(controllerEnv, "DATABASE_URL=file:./dev.db\n", "utf8");
  writeFileSync(controllerDevEnv, "DATABASE_URL=file:./dev-lab.db\n", "utf8");
  writeFileSync(registryEnv, "API_HOST=0.0.0.0\n", "utf8");

  const results = syncAgentApiKeyToConsumers(baseline, "demo-agent", "secret-key");
  assert.equal(results.length, 3);
  assert.equal(results.every((result) => result.updated), true);

  assert.equal(readAgentApiKeysMap(controllerDevEnv)["demo-agent"], "secret-key");
});

test("syncGraphDbCredentialsToClone copies username, password, and internal GraphDB URLs", () => {
  const root = mkdtempSync(join(tmpdir(), "env-graphdb-sync-"));
  const controllerEnv = join(root, "SimulatorController", ".env");
  const cloneEnv = join(root, "clone", ".env");
  mkdirSync(join(root, "SimulatorController"), { recursive: true });
  mkdirSync(join(root, "clone"), { recursive: true });
  writeFileSync(
    controllerEnv,
    // Controller .env often quotes values; sync must not encode those quotes into the URL.
    'GRAPHDB_BASE_URL=http://127.0.0.1:7200/\nGRAPHDB_USERNAME="telenor"\nGRAPHDB_PASSWORD="partner-secret"\nGRAPHDB_INFRA_REPOSITORY_ID="telenor-infrastructure-5g4data"\nGRAPHDB_INFRA_NAMED_GRAPH="http://intendproject.eu/telenor/infra"\n',
    "utf8"
  );
  writeFileSync(
    cloneEnv,
    "GRAPHDB_ENDPOINT=https://example/graphdb/repositories/demo/sparql\n",
    "utf8"
  );

  const result = syncGraphDbCredentialsToClone(controllerEnv, cloneEnv);
  assert.equal(result.updated, true);
  assert.equal(readDotEnvKey(cloneEnv, "GRAPHDB_USERNAME"), "telenor");
  assert.equal(readDotEnvKey(cloneEnv, "GRAPHDB_PASSWORD"), "partner-secret");
  assert.equal(readDotEnvKey(cloneEnv, "GRAPHDB_BASE_URL"), "http://host.docker.internal:7200/");
  assert.equal(
    readDotEnvKey(cloneEnv, "GRAPHDB_ENDPOINT"),
    "http://host.docker.internal:7200/repositories/demo",
  );
  assert.equal(readDotEnvKey(cloneEnv, "GRAPHDB_INFRA_REPOSITORY_ID"), "telenor-infrastructure-5g4data");
  assert.equal(
    readDotEnvKey(cloneEnv, "GRAPHDB_INFRA_ENDPOINT"),
    "http://host.docker.internal:7200/repositories/telenor-infrastructure-5g4data",
  );
});
