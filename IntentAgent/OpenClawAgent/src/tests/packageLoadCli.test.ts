import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockPackageSource =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/IntentAgent/OpenClawPackages/package-template";
const builtCliPath =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/IntentAgent/OpenClawAgent/dist/index.js";

test("CLI package load installs package and creates agent clone", () => {
  const root = mkdtempSync(join(tmpdir(), "pkg-load-cli-"));
  const baseline = join(root, "OpenClawAgent");
  const archivePath = join(root, "package-template.tgz");
  execFileSync("mkdir", ["-p", baseline], { stdio: "pipe" });
  writeFileSync(join(baseline, ".env"), "LLM_PROVIDER=openai\n", "utf8");
  writeFileSync(join(baseline, "README.md"), "baseline\n", "utf8");
  execFileSync("tar", ["-czf", archivePath, "-C", mockPackageSource, "."], { stdio: "pipe" });

  const output = execFileSync(process.execPath, [builtCliPath, "package", "load", archivePath], {
    cwd: baseline,
    encoding: "utf8"
  });
  assert.match(output, /Package installed: package-template/);

  const siblings = readdirSync(root);
  const clone = siblings.find((name) => name.startsWith("OpenClawAgent-package-template"));
  assert.ok(clone, "expected clone folder");
  const cloneDir = join(root, clone as string);
  assert.ok(existsSync(join(cloneDir, ".env")));
  const clonedEnv = readFileSync(join(cloneDir, ".env"), "utf8");
  assert.match(clonedEnv, /DOMAIN_PACKAGE_DIR=\.\.\/OpenClawPackages\/package-template/);
  assert.match(clonedEnv, /SKILL_FILE=\.\.\/OpenClawPackages\/package-template\/skills\/SKILL\.md/);
});
