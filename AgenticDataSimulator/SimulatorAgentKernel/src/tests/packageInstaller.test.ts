import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installPackageFromPath } from "../core/packageInstaller.js";

const mockPackageSource =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/IntentAgent/OpenClawPackages/package-template";

test("installPackageFromPath installs and validates package from tgz", () => {
  const root = mkdtempSync(join(tmpdir(), "pkg-install-"));
  const archivePath = join(root, "package-template.tgz");
  const packagesRoot = join(root, "OpenClawPackages");

  execFileSync("tar", ["-czf", archivePath, "-C", mockPackageSource, "."], { stdio: "pipe" });
  const result = installPackageFromPath({ sourcePath: archivePath, packagesRoot });

  assert.equal(result.packageName, "package-template");
  assert.ok(existsSync(result.packageDir));
  assert.ok(existsSync(result.skillPath));
});

test("installPackageFromPath installs from unpacked directory", () => {
  const root = mkdtempSync(join(tmpdir(), "pkg-install-dir-"));
  const sourceDir = join(root, "mock-dir");
  const packagesRoot = join(root, "OpenClawPackages");
  cpSync(mockPackageSource, sourceDir, { recursive: true });
  const result = installPackageFromPath({ sourcePath: sourceDir, packagesRoot });
  assert.equal(result.packageName, "package-template");
  assert.ok(existsSync(result.packageDir));
  assert.ok(existsSync(result.skillPath));
});

test("installPackageFromPath rejects archive without manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "pkg-install-empty-"));
  const source = join(root, "empty-package");
  const packagesRoot = join(root, "OpenClawPackages");
  const archivePath = join(root, "empty.tgz");
  execFileSync("mkdir", ["-p", source], { stdio: "pipe" });
  execFileSync("tar", ["-czf", archivePath, "-C", source, "."], { stdio: "pipe" });
  assert.throws(
    () => installPackageFromPath({ sourcePath: archivePath, packagesRoot }),
    /manifest\.json/
  );
});
