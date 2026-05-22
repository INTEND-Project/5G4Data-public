import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateEnvFile } from "../core/envConfigWriter.js";

test("updateEnvFile upserts domain and skill values", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-writer-"));
  const envPath = join(dir, ".env");
  writeFileSync(
    envPath,
    "LLM_PROVIDER=openai\nDOMAIN_PACKAGE_DIR=old\n#comment\nOPENAI_MODEL=test\n",
    "utf8"
  );

  updateEnvFile(envPath, [
    { key: "DOMAIN_PACKAGE_DIR", value: "../OpenClawPackages/package-template" },
    { key: "SKILL_FILE", value: "../OpenClawPackages/package-template/skills/SKILL.md" }
  ]);

  const content = readFileSync(envPath, "utf8");
  assert.match(content, /DOMAIN_PACKAGE_DIR=\.\.\/OpenClawPackages\/package-template/);
  assert.match(content, /SKILL_FILE=\.\.\/OpenClawPackages\/package-template\/skills\/SKILL\.md/);
  assert.match(content, /OPENAI_MODEL=test/);
});
