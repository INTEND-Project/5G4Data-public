import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { applyOnPackageLoad, syncCloneLockfile } from "../tools/onPackageLoad.js";

test("applyOnPackageLoad upserts prometheus env and merges deps", async () => {
  const root = mkdtempSync(join(tmpdir(), "on-package-load-"));
  const packageDir = join(root, "package");
  const cloneDir = join(root, "clone");
  const mappingsDir = join(packageDir, "mappings");
  mkdirSync(mappingsDir, { recursive: true });
  mkdirSync(cloneDir, { recursive: true });
  let lockfileSyncCalls = 0;

  writeFileSync(
    join(mappingsDir, "env.defaults.json"),
    JSON.stringify(
      {
        PROMETHEUS_URL: "http://127.0.0.1:9090/prometheus",
        PROMETHEUS_REMOTE_WRITE_URL: "http://host.docker.internal:9090/prometheus/api/v1/write",
        PUSHGATEWAY_URL: "http://host.docker.internal:9091"
      },
      null,
      2
    ),
    "utf8"
  );
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify(
      {
        name: "5g4data-intent-observations",
        dependencies: { protobufjs: "^8.4.2", snappyjs: "^0.7.0" }
      },
      null,
      2
    ),
    "utf8"
  );
  writeFileSync(
    join(cloneDir, "package.json"),
    JSON.stringify({ name: "clone", dependencies: { n3: "^1.17.4" } }, null, 2),
    "utf8"
  );
  writeFileSync(join(cloneDir, ".env"), "LLM_PROVIDER=openai\n", "utf8");

  const result = await applyOnPackageLoad(
    { cloneDir, packageDir },
    {
      syncLockfile: (dir) => {
        lockfileSyncCalls += 1;
        assert.equal(dir, cloneDir);
        writeFileSync(
          join(dir, "package-lock.json"),
          JSON.stringify(
            {
              name: "clone",
              lockfileVersion: 3,
              packages: {
                "": { dependencies: { n3: "^1.17.4", protobufjs: "^8.4.2", snappyjs: "^0.7.0" } }
              }
            },
            null,
            2
          ),
          "utf8"
        );
      }
    }
  );
  assert.equal(lockfileSyncCalls, 1);
  assert.equal(result.runtimePatches?.cliNoGraphDbFlag, true);

  const env = readFileSync(join(cloneDir, ".env"), "utf8");
  assert.match(env, /PROMETHEUS_URL=http:\/\/127\.0\.0\.1:9090\/prometheus/);
  assert.match(env, /PROMETHEUS_REMOTE_WRITE_URL=http:\/\/host\.docker\.internal:9090\/prometheus\/api\/v1\/write/);
  assert.match(env, /PUSHGATEWAY_URL=http:\/\/host\.docker\.internal:9091/);

  const clonePkg = JSON.parse(readFileSync(join(cloneDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(clonePkg.dependencies.n3, "^1.17.4");
  assert.equal(clonePkg.dependencies.protobufjs, "^8.4.2");
  assert.equal(clonePkg.dependencies.snappyjs, "^0.7.0");

  const lockfile = readFileSync(join(cloneDir, "package-lock.json"), "utf8");
  assert.match(lockfile, /protobufjs/);
  assert.match(lockfile, /snappyjs/);
});

test("applyOnPackageLoad skips lockfile sync when clone deps already include package deps", async () => {
  const root = mkdtempSync(join(tmpdir(), "on-package-load-skip-"));
  const packageDir = join(root, "package");
  const cloneDir = join(root, "clone");
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(cloneDir, { recursive: true });
  let lockfileSyncCalls = 0;

  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "pkg", dependencies: { snappyjs: "^0.7.0" } }, null, 2),
    "utf8"
  );
  writeFileSync(
    join(cloneDir, "package.json"),
    JSON.stringify({ name: "clone", dependencies: { n3: "^1.17.4", snappyjs: "^0.7.0" } }, null, 2),
    "utf8"
  );

  await applyOnPackageLoad(
    { cloneDir, packageDir },
    {
      syncLockfile: () => {
        lockfileSyncCalls += 1;
      }
    }
  );
  assert.equal(lockfileSyncCalls, 0);
});

test("syncCloneLockfile updates package-lock.json for merged dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "on-package-load-npm-"));
  const cloneDir = join(root, "clone");
  mkdirSync(cloneDir, { recursive: true });
  writeFileSync(
    join(cloneDir, "package.json"),
    JSON.stringify(
      {
        name: "clone",
        dependencies: { n3: "^1.17.4", protobufjs: "^8.4.2", snappyjs: "^0.7.0" }
      },
      null,
      2
    ),
    "utf8"
  );

  syncCloneLockfile(cloneDir);

  const lockfile = readFileSync(join(cloneDir, "package-lock.json"), "utf8");
  assert.match(lockfile, /protobufjs/);
  assert.match(lockfile, /snappyjs/);
});
