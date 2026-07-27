import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DeployPackageToolsInput {
  packageDir: string;
  cloneDir: string;
}

export interface DeployPackageToolsResult {
  copiedToolFiles: string[];
}

export function deployPackageToolsToClone(input: DeployPackageToolsInput): DeployPackageToolsResult {
  const toolsDir = join(input.packageDir, "tools");
  if (!existsSync(toolsDir)) {
    return { copiedToolFiles: [] };
  }
  const tsTools = readdirSync(toolsDir).filter((name) => name.endsWith(".ts"));
  if (tsTools.length === 0) {
    return { copiedToolFiles: [] };
  }
  const cloneToolsDir = join(input.cloneDir, "src", "tools");
  mkdirSync(cloneToolsDir, { recursive: true });
  for (const fileName of tsTools) {
    copyFileSync(join(toolsDir, fileName), join(cloneToolsDir, fileName));
  }
  return { copiedToolFiles: tsTools.sort() };
}
