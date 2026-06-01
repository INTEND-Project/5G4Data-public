#!/usr/bin/env bash
# Dev Controller on port 3001 using next start (prod-like speed, no hot reload).
# Re-run after source changes: npm run dev:lab:build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ROOT}/.env.dev"
if [ ! -f "$ENV_FILE" ]; then
  echo "error: missing ${ENV_FILE} (copy from .env.dev.example)" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

export CONTROLLER_DEV_DIST=1
export NODE_ENV=production

DIST_DIR="${ROOT}/.next-dev-prod"
if [ ! -d "$DIST_DIR" ]; then
  echo "error: missing ${DIST_DIR}; run npm run dev:lab:build first" >&2
  exit 1
fi

exec npx next start --hostname 0.0.0.0 -p 3001
