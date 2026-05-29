#!/usr/bin/env bash
# Start the dev Controller on port 3001 (hot reload). Prod stays on 3000 via systemd.
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

export NODE_ENV=development
exec npx next dev --turbopack --hostname 0.0.0.0 -p 3001
