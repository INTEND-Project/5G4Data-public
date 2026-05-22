import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface EnvUpdate {
  key: string;
  value: string;
}

/** Keys always set explicitly by `package load` for clones — never copied from `mappings/env.defaults.json`. */
const CLONE_EXPLICIT_ENV_KEYS = new Set(["DOMAIN_PACKAGE_DIR", "SKILL_FILE"]);

/**
 * Optional keys merged from `mappings/env.defaults.json` into a new clone.
 * Restricted so we do not overwrite operator-tuned values (e.g. GraphDB) with package templates.
 */
const CLONE_SAFE_DEFAULT_ENV_KEYS = new Set([
  "A2A_AGENT_BASE_URL",
  "A2A_REGISTRY_BASE_URL",
  "API_SERVER_PORT"
]);

export function readDotEnvKey(envFilePath: string, key: string): string | undefined {
  if (!existsSync(envFilePath)) return undefined;
  const text = readFileSync(envFilePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const existingKey = line.slice(0, index).trim();
    if (existingKey !== key) continue;
    return line.slice(index + 1).trim();
  }
  return undefined;
}

/**
 * Upsert env vars from `packageDir/mappings/env.defaults.json` into the clone `.env`.
 * Skips `DOMAIN_PACKAGE_DIR` and `SKILL_FILE` so `package load` can set those to `./` and the deployed skill path.
 */
export function applyPackageMappingEnvDefaults(cloneEnvPath: string, packageDir: string): void {
  const defaultsPath = join(packageDir, "mappings", "env.defaults.json");
  if (!existsSync(defaultsPath)) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(defaultsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  const updates: EnvUpdate[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (CLONE_EXPLICIT_ENV_KEYS.has(key)) continue;
    if (!CLONE_SAFE_DEFAULT_ENV_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    updates.push({ key, value: String(value) });
  }
  if (updates.length === 0) return;
  updateEnvFile(cloneEnvPath, updates);
}

function upsertKey(lines: string[], key: string, value: string): string[] {
  const assignment = `${key}=${value}`;
  let replaced = false;
  const updated = lines.map((line) => {
    if (line.trim().startsWith("#")) return line;
    const index = line.indexOf("=");
    if (index <= 0) return line;
    const existingKey = line.slice(0, index).trim();
    if (existingKey !== key) return line;
    replaced = true;
    return assignment;
  });
  if (!replaced) {
    updated.push(assignment);
  }
  return updated;
}

export function updateEnvFile(path: string, updates: EnvUpdate[]): void {
  const original = readFileSync(path, "utf8");
  const lines = original.split(/\r?\n/);
  let next = lines;
  for (const update of updates) {
    next = upsertKey(next, update.key, update.value);
  }
  const normalized = next.join("\n").replace(/\n*$/g, "\n");
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, normalized, "utf8");
  renameSync(tmpPath, path);
}
