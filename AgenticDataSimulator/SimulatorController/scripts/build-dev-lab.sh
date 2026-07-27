#!/usr/bin/env bash
# Production build for the dev lab instance (.env.dev, /tmf-simulator-dev, port 3001).
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

npm run build
