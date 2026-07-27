#!/usr/bin/env bash
# Copy prod Controller SQLite state into the dev database (users, scripts, KG targets, etc.).
# Prod DB is read-only via sqlite3 .backup; only the dev file is written.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_CONFIRM=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: scripts/sync-prod-db-to-dev.sh [OPTIONS]

Copy prod Controller SQLite (from .env DATABASE_URL) into dev (from .env.dev).

  --yes       Skip confirmation prompt
  --dry-run   Print resolved paths only; do not copy

Stop the dev server (port 3001) before syncing so dev is not writing the DB.

Requires: sqlite3
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes)
      SKIP_CONFIRM=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "error: sqlite3 is required" >&2
  exit 1
fi

resolve_database_path() {
  local env_file="$1"
  local label="$2"

  if [ ! -f "$env_file" ]; then
    echo "error: missing ${label} env file: ${env_file}" >&2
    exit 1
  fi

  local database_url
  database_url="$(
    grep -E '^[[:space:]]*DATABASE_URL=' "$env_file" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^["'\'' ]*//' -e 's/["'\'' ]*$//'
  )"

  if [ -z "$database_url" ]; then
    echo "error: DATABASE_URL not set in ${env_file}" >&2
    exit 1
  fi

  case "$database_url" in
    file:*)
      local db_path="${database_url#file:}"
      ;;
    *)
      echo "error: only file: SQLite DATABASE_URL is supported in ${env_file} (got: ${database_url})" >&2
      exit 1
      ;;
  esac

  if [[ "$db_path" != /* ]]; then
    db_path="${ROOT}/prisma/${db_path#./}"
  fi

  printf '%s' "$db_path"
}

PROD_ENV="${ROOT}/.env"
DEV_ENV="${ROOT}/.env.dev"

PROD_DB="$(resolve_database_path "$PROD_ENV" "prod")"
DEV_DB="$(resolve_database_path "$DEV_ENV" "dev")"

if [ "$PROD_DB" = "$DEV_DB" ]; then
  echo "error: prod and dev resolve to the same database file: ${PROD_DB}" >&2
  exit 1
fi

if [ ! -f "$PROD_DB" ]; then
  echo "error: prod database file not found: ${PROD_DB}" >&2
  exit 1
fi

echo "Prod DB: ${PROD_DB}"
echo "Dev DB:  ${DEV_DB}"

if $DRY_RUN; then
  echo "Dry run — no changes made."
  exit 0
fi

if command -v ss >/dev/null 2>&1; then
  if ss -tln 2>/dev/null | grep -q ':3001 '; then
    echo "warning: something is listening on port 3001 — stop the dev Controller before syncing." >&2
  fi
fi

if ! $SKIP_CONFIRM; then
  echo ""
  echo "This will replace the dev database with a copy of prod."
  if [ -f "$DEV_DB" ]; then
    echo "Existing dev DB will be backed up as dev-lab.db.bak.<timestamp>"
  fi
  read -r -p "Continue? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

DEV_DIR="$(dirname "$DEV_DB")"
mkdir -p "$DEV_DIR"

if [ -f "$DEV_DB" ]; then
  STAMP="$(date +%Y%m%d%H%M%S)"
  BACKUP="${DEV_DB}.bak.${STAMP}"
  mv "$DEV_DB" "$BACKUP"
  echo "Backed up dev DB to: ${BACKUP}"
fi

sqlite3 "$PROD_DB" ".backup '${DEV_DB}'"

count_rows() {
  local table="$1"
  sqlite3 "$DEV_DB" "SELECT COUNT(*) FROM \"${table}\";"
}

echo ""
echo "Sync complete. Dev row counts:"
echo "  User: $(count_rows User)"
echo "  Script: $(count_rows Script)"
echo "  KnowledgeGraphTarget: $(count_rows KnowledgeGraphTarget)"
echo "  ScriptRun: $(count_rows ScriptRun)"
echo "  ScriptRunLog: $(count_rows ScriptRunLog)"
echo "  UserIntent: $(count_rows UserIntent)"
echo "  Session: $(count_rows Session)"
