import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { generateAgentApiKey } from "./a2a/auth.js";

export interface EnvUpdate {
  key: string;
  value: string;
}

/** Keys always set explicitly by `package load` for clones — never copied from `mappings/env.defaults.json`. */
const CLONE_EXPLICIT_ENV_KEYS = new Set(["DOMAIN_PACKAGE_DIR", "SKILL_FILE", "SHACL_SHAPES_FILE"]);

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

/** Generate and persist AGENT_API_KEY for a new clone unless one is already set. */
export function ensureAgentApiKeyForClone(cloneEnvPath: string): string {
  const existing = readDotEnvKey(cloneEnvPath, "AGENT_API_KEY")?.trim();
  if (existing) return existing;
  const generated = generateAgentApiKey();
  updateEnvFile(cloneEnvPath, [{ key: "AGENT_API_KEY", value: generated }]);
  return generated;
}

const AGENT_API_KEYS_ENV_KEY = "AGENT_API_KEYS";

function stripEnvQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function readAgentApiKeysMap(envFilePath: string): Record<string, string> {
  const raw = readDotEnvKey(envFilePath, AGENT_API_KEYS_ENV_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(stripEnvQuotes(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof value === "string" && value.trim()) {
        result[key] = value.trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

function formatAgentApiKeysEnvValue(map: Record<string, string>): string {
  return `'${JSON.stringify(map)}'`;
}

export function upsertAgentApiKeysEntry(
  envFilePath: string,
  agentName: string,
  apiKey: string
): void {
  ensureEnvFileExists(envFilePath);
  const merged = {
    ...readAgentApiKeysMap(envFilePath),
    [agentName]: apiKey
  };
  updateEnvFile(envFilePath, [
    { key: AGENT_API_KEYS_ENV_KEY, value: formatAgentApiKeysEnvValue(merged) }
  ]);
}

function ensureEnvFileExists(envFilePath: string): void {
  if (existsSync(envFilePath)) return;
  const parent = dirname(envFilePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(envFilePath, `${AGENT_API_KEYS_ENV_KEY}={}\n`, "utf8");
}

export interface SyncAgentApiKeyResult {
  path: string;
  updated: boolean;
  skipped: boolean;
  reason?: string;
}

export interface SyncAgentApiKeyTargets {
  controllerEnvPath: string;
  controllerDevEnvPath: string;
  registryEnvPath: string;
}

export function defaultAgentApiKeySyncTargets(baselineAgentDir: string): SyncAgentApiKeyTargets {
  const root = resolve(baselineAgentDir, "..");
  return {
    controllerEnvPath: join(root, "SimulatorController", ".env"),
    controllerDevEnvPath: join(root, "SimulatorController", ".env.dev"),
    registryEnvPath: join(root, "a2a-registry", "backend", ".env")
  };
}

function syncAgentApiKeyToEnvFile(
  envFilePath: string,
  agentName: string,
  apiKey: string
): SyncAgentApiKeyResult {
  if (!existsSync(envFilePath)) {
    upsertAgentApiKeysEntry(envFilePath, agentName, apiKey);
    return { path: envFilePath, updated: true, skipped: false };
  }
  const before = readAgentApiKeysMap(envFilePath);
  upsertAgentApiKeysEntry(envFilePath, agentName, apiKey);
  const after = readAgentApiKeysMap(envFilePath);
  const updated = before[agentName] !== after[agentName] || !(agentName in before);
  return { path: envFilePath, updated, skipped: false };
}

/** Merge clone agent key into SimulatorController and a2a-registry consumer .env files. */
export function syncAgentApiKeyToConsumers(
  baselineAgentDir: string,
  agentName: string,
  apiKey: string,
  targets?: Partial<SyncAgentApiKeyTargets>
): SyncAgentApiKeyResult[] {
  const resolved = {
    ...defaultAgentApiKeySyncTargets(baselineAgentDir),
    ...targets
  };
  const results = [
    syncAgentApiKeyToEnvFile(resolved.controllerEnvPath, agentName, apiKey),
    syncAgentApiKeyToEnvFile(resolved.registryEnvPath, agentName, apiKey)
  ];
  if (existsSync(resolved.controllerDevEnvPath)) {
    results.push(syncAgentApiKeyToEnvFile(resolved.controllerDevEnvPath, agentName, apiKey));
  }
  return results;
}
