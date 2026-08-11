import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deployPackageToClone } from "../core/packageCloneDeployer.js";

test("package load hook contributes runtimePatches without source patching", async () => {
  const root = mkdtempSync(join(tmpdir(), "pkg-clone-deployer-"));
  const packageDir = join(root, "pkg");
  const cloneDir = join(root, "clone");
  mkdirSync(join(packageDir, "tools"), { recursive: true });
  writeFileSync(
    join(packageDir, "manifest.json"),
    JSON.stringify(
      {
        runtimeHooks: {
          onPackageLoad: "tools/onPackageLoad.ts"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  writeFileSync(
    join(packageDir, "tools", "onPackageLoad.ts"),
    `export async function applyOnPackageLoad() {
  return { runtimePatches: { cliNoGraphDbFlag: true } };
}
`,
    "utf8"
  );

  await deployPackageToClone({ packageDir, cloneDir });
  const clonedManifest = JSON.parse(readFileSync(join(cloneDir, "manifest.json"), "utf8")) as {
    runtimePatches?: { cliNoGraphDbFlag?: boolean };
  };
  assert.equal(clonedManifest.runtimePatches?.cliNoGraphDbFlag, true);
});
