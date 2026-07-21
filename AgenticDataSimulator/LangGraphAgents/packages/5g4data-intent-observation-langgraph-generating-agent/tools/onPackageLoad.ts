import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface PackageRuntimeContributions {
  runtimePatches?: {
    cliNoGraphDbFlag?: boolean;
  };
}

const PROMETHEUS_ENV_KEYS = [
  "PROMETHEUS_URL",
  "PROMETHEUS_REMOTE_WRITE_URL",
  "PUSHGATEWAY_URL"
] as const;

const LEGACY_PROMETHEUS_VALUES = new Set([
  "https://start5g-1.cs.uit.no/prometheus",
  "https://start5g-1.cs.uit.no/prometheus-pushgateway",
  "http://host.docker.internal:9090",
  "http://host.docker.internal:9090/prometheus",
  "http://host.docker.internal:9090/prometheus/api/v1/write",
  "http://host.docker.internal:9091",
  "http://127.0.0.1:9090/prometheus"
]);

function upsertEnvKey(lines: string[], key: string, value: string): string[] {
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
  if (!replaced) updated.push(assignment);
  return updated;
}

function readEnvValue(envPath: string, key: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    if (line.slice(0, index).trim() !== key) continue;
    return line.slice(index + 1).trim();
  }
  return undefined;
}

function applyPrometheusEnvDefaults(cloneDir: string, packageDir: string): void {
  const defaultsPath = join(packageDir, "mappings", "env.defaults.json");
  if (!existsSync(defaultsPath)) return;

  let defaults: Record<string, unknown>;
  try {
    defaults = JSON.parse(readFileSync(defaultsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }

  const envPath = join(cloneDir, ".env");
  const existingLines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  let lines = existingLines;

  for (const key of PROMETHEUS_ENV_KEYS) {
    const value = defaults[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const current = readEnvValue(envPath, key);
    if (current === undefined || current === "" || LEGACY_PROMETHEUS_VALUES.has(current)) {
      lines = upsertEnvKey(lines, key, value);
    }
  }

  writeFileSync(envPath, `${lines.filter((line, i, arr) => line.length > 0 || i < arr.length - 1).join("\n")}\n`, "utf8");
}

export type NpmLockfileSyncRunner = (cloneDir: string) => void;

function defaultNpmLockfileSync(cloneDir: string): void {
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
    cwd: cloneDir,
    stdio: "pipe",
    encoding: "utf8"
  });
}

function dependenciesRecordEqual(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined
): boolean {
  const a = left ?? {};
  const b = right ?? {};
  const leftKeys = Object.keys(a).sort();
  const rightKeys = Object.keys(b).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && a[key] === b[key]);
}

function mergePackageDependencies(cloneDir: string, packageDir: string): boolean {
  const packageJsonPath = join(packageDir, "package.json");
  const clonePackageJsonPath = join(cloneDir, "package.json");
  if (!existsSync(packageJsonPath) || !existsSync(clonePackageJsonPath)) return false;

  let pkg: { dependencies?: Record<string, string> };
  let clonePkg: { dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { dependencies?: Record<string, string> };
    clonePkg = JSON.parse(readFileSync(clonePackageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
  } catch {
    return false;
  }

  const mergedDependencies = {
    ...(clonePkg.dependencies ?? {}),
    ...(pkg.dependencies ?? {})
  };
  if (dependenciesRecordEqual(clonePkg.dependencies, mergedDependencies)) {
    return false;
  }

  clonePkg.dependencies = mergedDependencies;
  writeFileSync(clonePackageJsonPath, `${JSON.stringify(clonePkg, null, 2)}\n`, "utf8");
  return true;
}

export function syncCloneLockfile(
  cloneDir: string,
  runNpm: NpmLockfileSyncRunner = defaultNpmLockfileSync
): void {
  if (!existsSync(join(cloneDir, "package.json"))) return;
  runNpm(cloneDir);
}

const PRETTY_PRINT_VENDOR_FILES = [
  "prettyPrintIntentTurtle.ts",
  "postprocess/coordinationUtility.ts",
  "postprocess/coordinationUtilityDerive.ts"
] as const;

/** Copy intent-generation pretty-print helpers into the self-contained observation clone. */
export function vendorPrettyPrintIntentTurtle(cloneDir: string, packageDir: string): void {
  const intentGenToolsDir = join(packageDir, "..", "5g4data-intent-langgraph-generating-agent", "tools");
  const prettyPrintSource = join(intentGenToolsDir, "prettyPrintIntentTurtle.ts");
  if (!existsSync(prettyPrintSource)) return;

  for (const toolsRoot of ["tools", join("src", "tools")] as const) {
    const destinationToolsDir = join(cloneDir, toolsRoot);
    for (const relativePath of PRETTY_PRINT_VENDOR_FILES) {
      const sourcePath = join(intentGenToolsDir, relativePath);
      if (!existsSync(sourcePath)) continue;
      const destinationPath = join(destinationToolsDir, relativePath);
      mkdirSync(dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

export async function applyOnPackageLoad(
  args: {
    cloneDir: string;
    packageDir: string;
  },
  options?: {
    syncLockfile?: NpmLockfileSyncRunner;
  }
): Promise<PackageRuntimeContributions> {
  applyPrometheusEnvDefaults(args.cloneDir, args.packageDir);
  vendorPrettyPrintIntentTurtle(args.cloneDir, args.packageDir);
  const dependenciesChanged = mergePackageDependencies(args.cloneDir, args.packageDir);
  if (dependenciesChanged) {
    syncCloneLockfile(args.cloneDir, options?.syncLockfile);
  }

  return {
    runtimePatches: {
      cliNoGraphDbFlag: true
    }
  };
}
