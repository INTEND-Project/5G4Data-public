# Dependencies

Runtime npm dependencies for this package live in [`package.json`](../package.json) (`n3`, `protobufjs`, `snappyjs`). On `package load`, `onPackageLoad` merges these into the clone `package.json` and runs `npm install --package-lock-only` so Docker `npm ci` stays in sync.

On `package load`, `tools/onPackageLoad.ts` merges these dependencies into the agent clone's `package.json` so `docker compose build` installs them.
