import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface DeployPackageToCloneInput {
  packageDir: string;
  cloneDir: string;
  packageName?: string;
}

export interface DeployPackageToCloneResult {
  deployedPackageDir: string;
}

export async function deployPackageToClone(
  input: DeployPackageToCloneInput
): Promise<DeployPackageToCloneResult> {
  const deployedPackageDir = input.cloneDir;
  const copyTargets = [
    "manifest.json",
    "workflow.dsl.json",
    "compatibility.json",
    "checksums.txt",
    "rules",
    "validators",
    "tools",
    "prompts",
    "prompt_modules",
    "skills",
    "dependencies",
    "schemas",
    "validation",
    "examples",
    "tests",
    "mappings",
    "metadata"
  ];

  mkdirSync(input.cloneDir, { recursive: true });
  for (const target of copyTargets) {
    const sourcePath = join(input.packageDir, target);
    if (!existsSync(sourcePath)) continue;
    const destinationPath = join(input.cloneDir, target);
    if (existsSync(destinationPath)) {
      rmSync(destinationPath, { recursive: true, force: true });
    }
    cpSync(sourcePath, destinationPath, { recursive: true });
  }

  await runPackageLoadHook(input.packageDir, input.cloneDir);

  return { deployedPackageDir };
}

async function runPackageLoadHook(packageDir: string, cloneDir: string): Promise<void> {
  const manifestPath = join(packageDir, "manifest.json");
  if (!existsSync(manifestPath)) return;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      runtimeHooks?: { onPackageLoad?: string };
    };
    const relHookPath = raw.runtimeHooks?.onPackageLoad;
    if (!relHookPath) return;
    const absHookPath = join(packageDir, relHookPath);
    if (!existsSync(absHookPath)) return;
    const mod = (await import(pathToFileURL(absHookPath).href)) as {
      applyOnPackageLoad?: (args: {
        cloneDir: string;
        packageDir: string;
      }) =>
        | Promise<{ runtimePatches?: { cliNoGraphDbFlag?: boolean; writeIntentTurtleDebugFile?: boolean } } | void>
        | { runtimePatches?: { cliNoGraphDbFlag?: boolean; writeIntentTurtleDebugFile?: boolean } }
        | void;
    };
    const contributions = await mod.applyOnPackageLoad?.({ cloneDir, packageDir });
    if (!contributions?.runtimePatches) return;
    const cloneManifestPath = join(cloneDir, "manifest.json");
    if (!existsSync(cloneManifestPath)) return;
    const cloneManifest = JSON.parse(readFileSync(cloneManifestPath, "utf8")) as {
      runtimePatches?: { cliNoGraphDbFlag?: boolean; writeIntentTurtleDebugFile?: boolean };
    };
    cloneManifest.runtimePatches = {
      ...(cloneManifest.runtimePatches ?? {}),
      ...contributions.runtimePatches
    };
    writeFileSync(cloneManifestPath, `${JSON.stringify(cloneManifest, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(
      `[package load hook] onPackageLoad failed for ${packageDir}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}
