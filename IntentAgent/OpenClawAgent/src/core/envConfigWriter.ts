import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface EnvUpdate {
  key: string;
  value: string;
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
