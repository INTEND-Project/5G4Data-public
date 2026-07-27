import { cpSync, existsSync, mkdirSync } from "node:fs";
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
  /** When set (e.g. `i1`), creates exact clone dir `agents/<packageName>-<iterationLabel>` without auto `-v2` bump. */
  iterationLabel?: string;
}

/** Parent directory for runnable agent clones (`<repo>/agents/<package-name>`). */
export function cloneAgentsRoot(baselineAgentDir: string): string {
  return join(dirname(baselineAgentDir), "agents");
}

export interface CloneAgentResult {
  cloneDir: string;
  cloneName: string;
  version: number;
}

function resolveCloneTarget(
  preferred: string,
  iterationLabel?: string
): { path: string; version: number } {
  if (iterationLabel) {
    const label = sanitizeForFolderName(iterationLabel);
    const path = `${preferred}-${label}`;
    if (existsSync(path)) {
      throw new Error(
        `Clone directory already exists: ${path}. Remove it or use another PACKAGE_LOAD_ITERATION value.`
      );
    }
    return { path, version: 1 };
  }
  return nextCloneDir(preferred);
}

/**
 * Clone the LangGraphAgents kernel into `agents/<package-name>` (same layout as SimulatorAgentKernel).
 */
export function cloneAgentForPackage(input: CloneAgentInput): CloneAgentResult {
  const baseName = sanitizeForFolderName(input.packageName);
  const agentsRoot = cloneAgentsRoot(input.baselineAgentDir);
  mkdirSync(agentsRoot, { recursive: true });
  const preferred = join(agentsRoot, baseName);
  const selected = resolveCloneTarget(preferred, input.iterationLabel);

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
