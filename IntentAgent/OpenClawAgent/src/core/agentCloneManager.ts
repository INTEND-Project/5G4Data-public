import { cpSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const EXCLUDED_TOP_LEVEL = new Set([
  "node_modules",
  "dist",
  "logs",
  "packages"
]);

function sanitizeForFolderName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : "package";
}

function nextCloneDir(baseDir: string): { path: string; version: number } {
  if (!existsSync(baseDir)) {
    return { path: baseDir, version: 1 };
  }
  let version = 2;
  while (existsSync(`${baseDir}-v${version}`)) {
    version += 1;
  }
  return { path: `${baseDir}-v${version}`, version };
}

export interface CloneAgentInput {
  baselineAgentDir: string;
  packageName: string;
}

export interface CloneAgentResult {
  cloneDir: string;
  cloneName: string;
  version: number;
}

export function cloneAgentForPackage(input: CloneAgentInput): CloneAgentResult {
  const baseName = sanitizeForFolderName(input.packageName);
  const baselineName = basename(input.baselineAgentDir);
  const siblingRoot = dirname(input.baselineAgentDir);
  const preferred = join(siblingRoot, `${baselineName}-${baseName}`);
  const selected = nextCloneDir(preferred);

  cpSync(input.baselineAgentDir, selected.path, {
    recursive: true,
    force: false,
    filter: (source) => {
      const leaf = basename(source);
      if (EXCLUDED_TOP_LEVEL.has(leaf)) return false;
      return true;
    }
  });

  return {
    cloneDir: selected.path,
    cloneName: basename(selected.path),
    version: selected.version
  };
}
