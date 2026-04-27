import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CLONE_ONLY_REMOVE_PATHS = [
  "scripts/create-package-tgz.mjs",
  "src/core/packageInstaller.ts",
  "src/core/agentCloneManager.ts",
  "src/core/envConfigWriter.ts",
  "src/core/packageCloneDeployer.ts",
  "src/core/packageToolDeployer.ts",
  "src/tests/packageLoadCli.test.ts",
  "src/tests/packageInstaller.test.ts",
  "src/tests/packageToolDeployer.test.ts"
];

export function pruneClonePackagingArtifacts(cloneDir: string): void {
  for (const relativePath of CLONE_ONLY_REMOVE_PATHS) {
    const absolutePath = join(cloneDir, relativePath);
    if (!existsSync(absolutePath)) continue;
    rmSync(absolutePath, { recursive: true, force: true });
  }
  removePackageTgzScript(cloneDir);
}

function removePackageTgzScript(cloneDir: string): void {
  const packageJsonPath = join(cloneDir, "package.json");
  if (!existsSync(packageJsonPath)) return;
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  if (!packageJson.scripts?.["package:tgz"]) return;
  delete packageJson.scripts["package:tgz"];
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}
