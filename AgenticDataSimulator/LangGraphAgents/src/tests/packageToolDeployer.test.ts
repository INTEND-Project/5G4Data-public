import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deployPackageToolsToClone } from "../core/packageToolDeployer.js";

test("deployPackageToolsToClone copies TypeScript tools into clone src/tools", () => {
  const root = mkdtempSync(join(tmpdir(), "tool-deployer-"));
  const packageDir = join(root, "pkg");
  const cloneDir = join(root, "clone");
  mkdirSync(join(packageDir, "tools"), { recursive: true });
  mkdirSync(join(cloneDir, "src", "tools"), { recursive: true });
  writeFileSync(join(packageDir, "tools", "catalogueTool.ts"), "export const fromPackage = true;\n", "utf8");
  writeFileSync(join(packageDir, "tools", "bindings.json"), "{}\n", "utf8");

  const result = deployPackageToolsToClone({ packageDir, cloneDir });
  assert.deepEqual(result.copiedToolFiles, ["catalogueTool.ts"]);
  const copied = readFileSync(join(cloneDir, "src", "tools", "catalogueTool.ts"), "utf8");
  assert.match(copied, /fromPackage/);
});
