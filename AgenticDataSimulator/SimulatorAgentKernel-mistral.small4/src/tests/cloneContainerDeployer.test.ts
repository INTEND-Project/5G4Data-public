import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  containerLoadEnabled,
  containerNameForClone,
  dockerComposeFileArgs,
  ensureContainerEnvDefaults,
  healthCheckUrl,
  projectNameForClone,
  renderCloneDockerCompose,
  writeCloneDockerCompose
} from "../core/cloneContainerDeployer.js";

test("renderCloneDockerCompose includes container name and port mapping", () => {
  const content = renderCloneDockerCompose({
    cloneDir: "/tmp/clone",
    cloneName: "package-template",
    port: "3013"
  });
  assert.match(content, /container_name: package-template/);
  assert.match(content, /"3013:3013"/);
  assert.match(content, /API_SERVER_PORT: "3013"/);
  assert.match(content, /API_SERVER_HOST: "0.0.0.0"/);
  assert.match(content, /restart: unless-stopped/);
  assert.match(content, /host\.docker\.internal:172\.30\.0\.1/);
  assert.match(content, /command: \["npx", "tsx", "src\/index\.ts", "--debug"\]/);
  assert.match(content, /- \.\/logs:\/app\/logs/);
  assert.match(content, /name: mlflow-network/);
});

test("dockerComposeFileArgs includes override file when present", () => {
  const cloneDir = mkdtempSync(join(tmpdir(), "clone-compose-args-"));
  writeFileSync(join(cloneDir, "docker-compose.yml"), "services: {}\n", "utf8");

  assert.deepEqual(dockerComposeFileArgs(cloneDir), ["-f", "docker-compose.yml"]);

  writeFileSync(join(cloneDir, "docker-compose.override.yml"), "services: {}\n", "utf8");
  assert.deepEqual(dockerComposeFileArgs(cloneDir), [
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.override.yml"
  ]);
});

test("writeCloneDockerCompose writes docker-compose.yml to clone directory", () => {
  const cloneDir = mkdtempSync(join(tmpdir(), "clone-compose-"));
  const composePath = writeCloneDockerCompose({
    cloneDir,
    cloneName: "5g4data-intent-mistral-small4-generating-agent",
    port: "3011"
  });
  assert.match(composePath, /docker-compose\.yml$/);
  const content = readFileSync(composePath, "utf8");
  assert.match(content, /container_name: 5g4data-intent-mistral-small4-generating-agent/);
});

test("containerNameForClone and projectNameForClone sanitize names", () => {
  assert.equal(
    containerNameForClone("5g4data-intent-mistral-small4-generating-agent"),
    "5g4data-intent-mistral-small4-generating-agent"
  );
  assert.equal(
    projectNameForClone("5g4data-intent-mistral-small4-generating-agent"),
    "5g4data-intent-mistral-small4-generating-agent"
  );
});

test("ensureContainerEnvDefaults upserts API server settings when missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-env-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, "LLM_PROVIDER=openai\n", "utf8");

  ensureContainerEnvDefaults(envPath);
  const content = readFileSync(envPath, "utf8");
  assert.match(content, /API_SERVER_ENABLED=true/);
  assert.match(content, /API_SERVER_HOST=0\.0\.0\.0/);
});

test("ensureContainerEnvDefaults preserves existing API server settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-env-existing-"));
  const envPath = join(dir, ".env");
  writeFileSync(
    envPath,
    "API_SERVER_ENABLED=false\nAPI_SERVER_HOST=127.0.0.1\n",
    "utf8"
  );

  ensureContainerEnvDefaults(envPath);
  const content = readFileSync(envPath, "utf8");
  assert.match(content, /API_SERVER_ENABLED=false/);
  assert.match(content, /API_SERVER_HOST=127\.0\.0\.1/);
});

test("healthCheckUrl builds localhost health endpoint", () => {
  assert.equal(healthCheckUrl(3011), "http://127.0.0.1:3011/health");
});

test("containerLoadEnabled respects CONTAINER_LOAD env var", () => {
  const previous = process.env.CONTAINER_LOAD;
  try {
    delete process.env.CONTAINER_LOAD;
    assert.equal(containerLoadEnabled(), true);
    process.env.CONTAINER_LOAD = "false";
    assert.equal(containerLoadEnabled(), false);
    process.env.CONTAINER_LOAD = "0";
    assert.equal(containerLoadEnabled(), false);
    process.env.CONTAINER_LOAD = "true";
    assert.equal(containerLoadEnabled(), true);
  } finally {
    if (previous === undefined) {
      delete process.env.CONTAINER_LOAD;
    } else {
      process.env.CONTAINER_LOAD = previous;
    }
  }
});
