import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface DeployPackageToCloneInput {
  packageDir: string;
  cloneDir: string;
}

export interface DeployPackageToCloneResult {
  deployedPackageDir: string;
}

export function deployPackageToClone(input: DeployPackageToCloneInput): DeployPackageToCloneResult {
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
    "mappings"
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

  return { deployedPackageDir };
}
