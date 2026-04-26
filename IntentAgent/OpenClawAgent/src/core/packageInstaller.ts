import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { loadDomainPackage } from "./packageLoader.js";

function safeSegments(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("\0")) return false;
  const segments = normalized.split("/").filter((s) => s.length > 0);
  return !segments.some((segment) => segment === "..");
}

function assertArchiveSafe(archivePath: string): void {
  const entries = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const entry of entries) {
    if (!safeSegments(entry)) {
      throw new Error(`Archive contains unsafe path entry: ${entry}`);
    }
  }

  const details = execFileSync("tar", ["-tvzf", archivePath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  for (const line of details) {
    const typeChar = line[0];
    if (typeChar === "l" || typeChar === "h") {
      throw new Error("Archive contains symlink or hard-link entries, which are not allowed.");
    }
  }
}

function findManifestRootFromFs(rootDir: string): string {
  const queue: string[] = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const manifest = join(current, "manifest.json");
    if (existsSync(manifest)) {
      return current;
    }
    const children = readdirSync(current);
    for (const child of children) {
      const full = join(current, child);
      try {
        if (statSync(full).isDirectory()) {
        queue.push(full);
        }
      } catch {
        // ignore non-directory
      }
    }
  }
  throw new Error("Could not locate package manifest.json after extraction.");
}

function requireSkillFile(packageDir: string): string {
  const skillPath = join(packageDir, "skills", "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`Installed package is missing required skill file: ${skillPath}`);
  }
  return skillPath;
}

export interface InstallPackageInput {
  sourcePath: string;
  packagesRoot: string;
}

export interface InstallPackageResult {
  packageName: string;
  packageDir: string;
  skillPath: string;
}

function installFromDirectory(sourceDir: string, packagesRoot: string): InstallPackageResult {
  const extractedRoot = findManifestRootFromFs(sourceDir);
  const manifestText = readFileSync(join(extractedRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as { name?: string };
  if (!manifest.name || manifest.name.trim().length === 0) {
    throw new Error("Package manifest must include a non-empty name.");
  }
  const packageName = manifest.name.trim();
  const packageDir = join(packagesRoot, packageName);
  if (resolve(extractedRoot) === resolve(packageDir)) {
    loadDomainPackage(packageDir);
    const skillPath = requireSkillFile(packageDir);
    return { packageName, packageDir, skillPath };
  }
  if (existsSync(packageDir)) {
    rmSync(packageDir, { recursive: true, force: true });
  }
  cpSync(extractedRoot, packageDir, { recursive: true });
  loadDomainPackage(packageDir);
  const skillPath = requireSkillFile(packageDir);
  return { packageName, packageDir, skillPath };
}

export function installPackageFromPath(input: InstallPackageInput): InstallPackageResult {
  const sourcePath = resolve(input.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Package source does not exist: ${sourcePath}`);
  }
  const packagesRoot = resolve(input.packagesRoot);
  const stagingRoot = join(packagesRoot, ".staging");
  mkdirSync(packagesRoot, { recursive: true });

  if (statSync(sourcePath).isDirectory()) {
    return installFromDirectory(sourcePath, packagesRoot);
  }

  if (!sourcePath.endsWith(".tgz")) {
    throw new Error("Package source must be either a directory or a .tgz archive.");
  }

  mkdirSync(stagingRoot, { recursive: true });
  assertArchiveSafe(sourcePath);
  const stagingDir = join(stagingRoot, `install_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  mkdirSync(stagingDir, { recursive: true });
  try {
    execFileSync("tar", ["-xzf", sourcePath, "-C", stagingDir], { stdio: "pipe" });
    return installFromDirectory(stagingDir, packagesRoot);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
