#!/usr/bin/env bash
# Clear Controller SQLite data while keeping User accounts.
# Removes sessions, scripts, KG target registry, run logs, and intent ownership.
# Does NOT delete GraphDB repositories, Prometheus metrics, or agent data.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEEP_SESSIONS=false
KEEP_SCRIPTS=false
KEEP_SHARED_SCRIPTS=false

usage() {
  cat <<'EOF'
Usage: scripts/clear-controller-data.sh [OPTIONS]

Deletes Controller database rows except User (accounts and password hashes).

  --keep-sessions        Do not delete Session rows (users stay logged in)
  --keep-scripts         Do not delete any Script rows
  --keep-shared-scripts  Delete only private scripts; keep shared scripts

If both --keep-scripts and --keep-shared-scripts are given, all scripts are kept.

Requires: sqlite3, and DATABASE_URL in .env (default: file:./dev.db).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-sessions)
      KEEP_SESSIONS=true
      shift
      ;;
    --keep-scripts)
      KEEP_SCRIPTS=true
      shift
      ;;
    --keep-shared-scripts)
      KEEP_SHARED_SCRIPTS=true
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

if $KEEP_SCRIPTS && $KEEP_SHARED_SCRIPTS; then
  echo "note: --keep-scripts supersedes --keep-shared-scripts" >&2
  KEEP_SHARED_SCRIPTS=false
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "error: sqlite3 is required" >&2
  exit 1
fi

ENV_FILE="${ROOT}/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "error: missing ${ENV_FILE}" >&2
  exit 1
fi

DATABASE_URL="$(
  grep -E '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^["'\'' ]*//' -e 's/["'\'' ]*$//'
)"

if [ -z "$DATABASE_URL" ]; then
  echo "error: DATABASE_URL not set in .env" >&2
  exit 1
fi

case "$DATABASE_URL" in
  file:*)
    DB_PATH="${DATABASE_URL#file:}"
    ;;
  *)
    echo "error: only file: SQLite DATABASE_URL is supported (got: ${DATABASE_URL})" >&2
    exit 1
    ;;
esac

if [[ "$DB_PATH" != /* ]]; then
  DB_PATH="${ROOT}/prisma/${DB_PATH#./}"
fi

if [ ! -f "$DB_PATH" ]; then
  echo "error: database file not found: ${DB_PATH}" >&2
  exit 1
fi

count_rows() {
  local table="$1"
  sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM \"${table}\";"
}

USER_COUNT="$(count_rows User)"
echo "Database: ${DB_PATH}"
echo "Users (will be kept): ${USER_COUNT}"

TABLES=(ScriptRunLog ScriptRun UserIntent KnowledgeGraphTarget)
if ! $KEEP_SESSIONS; then
  TABLES=(Session "${TABLES[@]}")
fi
if ! $KEEP_SCRIPTS && ! $KEEP_SHARED_SCRIPTS; then
  TABLES+=(Script)
fi

echo "Will clear: ${TABLES[*]}"
if $KEEP_SCRIPTS; then
  echo "Scripts: keep all"
elif $KEEP_SHARED_SCRIPTS; then
  echo "Scripts: delete private only (keep shared)"
else
  echo "Scripts: delete all"
fi

read -r -p "Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

SQL="PRAGMA foreign_keys = ON;"
for table in "${TABLES[@]}"; do
  SQL="${SQL} DELETE FROM \"${table}\";"
done
if $KEEP_SHARED_SCRIPTS; then
  SQL="${SQL} DELETE FROM \"Script\" WHERE shared = 0;"
fi

sqlite3 "$DB_PATH" "$SQL"

echo ""
echo "Done. Remaining row counts:"
echo "  User: $(count_rows User)"
if ! $KEEP_SESSIONS; then
  echo "  Session: $(count_rows Session)"
fi
echo "  Script: $(count_rows Script) (shared: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM "Script" WHERE shared = 1;'))"
for table in KnowledgeGraphTarget ScriptRun ScriptRunLog UserIntent; do
  echo "  ${table}: $(count_rows "$table")"
done

echo ""
echo "Note: GraphDB repositories and Prometheus intent data were not modified."
