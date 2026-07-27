import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAgentApiKeysMap } from "../core/envConfigWriter.js";

const mockPackageSource =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages/package-template";
const builtCliPath =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentKernel/dist/index.js";

test("CLI package load installs package and creates agent clone", () => {
  const root = mkdtempSync(join(tmpdir(), "pkg-load-cli-"));
  const baseline = join(root, "SimulatorAgentKernel");
  const archivePath = join(root, "package-template.tgz");
  execFileSync("mkdir", ["-p", baseline], { stdio: "pipe" });
  writeFileSync(join(baseline, ".env"), "LLM_PROVIDER=openai\n", "utf8");
  writeFileSync(join(baseline, "README.md"), "baseline\n", "utf8");
  writeFileSync(join(baseline, "Dockerfile"), "FROM node:22-slim\n", "utf8");
  const controllerEnv = join(root, "SimulatorController", ".env");
  const registryEnv = join(root, "a2a-registry", "backend", ".env");
  mkdirSync(join(root, "SimulatorController"), { recursive: true });
  mkdirSync(join(root, "a2a-registry", "backend"), { recursive: true });
  writeFileSync(controllerEnv, "DATABASE_URL=file:./dev.db\n", "utf8");
  writeFileSync(registryEnv, "API_HOST=0.0.0.0\n", "utf8");
  execFileSync("tar", ["-czf", archivePath, "-C", mockPackageSource, "."], { stdio: "pipe" });

  const output = execFileSync(
    process.execPath,
    [builtCliPath, "package", "load", "--no-container", archivePath],
    {
      cwd: baseline,
      encoding: "utf8"
    }
  );
  assert.match(output, /Package installed: package-template/);

  const siblings = readdirSync(join(root, "agents"));
  const clone = siblings.find((name) => name === "package-template" || name.startsWith("package-template"));
  assert.ok(clone, "expected clone folder under agents/");
  const cloneDir = join(root, "agents", clone as string);
  assert.ok(existsSync(join(cloneDir, ".env")));
  const clonedEnv = readFileSync(join(cloneDir, ".env"), "utf8");
  assert.match(clonedEnv, /DOMAIN_PACKAGE_DIR=\.\/\n/);
  assert.match(clonedEnv, /SKILL_FILE=\.\/skills\/SKILL\.md/);
  assert.match(clonedEnv, /ENABLE_PACKAGE_LOAD=false/);
  assert.match(clonedEnv, /AGENT_API_KEY=[0-9a-f]{64}/);
  assert.match(output, /AGENT_API_KEYS updated in .*SimulatorController\/\.env/);
  assert.match(output, /AGENT_API_KEYS updated in .*a2a-registry\/backend\/\.env/);
  const controllerKeys = readAgentApiKeysMap(controllerEnv);
  const registryKeys = readAgentApiKeysMap(registryEnv);
  assert.equal(controllerKeys["package-template"], registryKeys["package-template"]);
  assert.match(controllerKeys["package-template"] ?? "", /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(cloneDir, "manifest.json")));
  assert.ok(existsSync(join(cloneDir, "Dockerfile")));
  assert.ok(!existsSync(join(cloneDir, "docker-compose.yml")));
  assert.ok(existsSync(join(cloneDir, "prompt_modules", "base.md")));
  assert.ok(existsSync(join(cloneDir, "rules", "classification.json")));
  assert.ok(!existsSync(join(cloneDir, "scripts", "create-package-tgz.mjs")));
  assert.ok(!existsSync(join(cloneDir, "src", "core", "packageInstaller.ts")));

  assert.throws(
    () =>
      execFileSync(process.execPath, [builtCliPath, "package", "load", archivePath], {
        cwd: cloneDir,
        encoding: "utf8",
        stdio: "pipe"
      }),
    /Package load is disabled in this cloned agent/
  );
});
