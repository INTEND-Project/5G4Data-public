#!/usr/bin/env bash
# Restart AgenticDataSimulator lab from current source:
#   - stop prod (3000) and dev (3001) Controllers
#   - force-reload agents (./agent-control reload; syncs AGENT_API_KEYS)
#   - start/restart a2a-registry (compose up -d, then api/worker restart) and IntentReportQueryProxy
#   - rebuild and restart both Controllers
#
# Systemd steps use sudo on start5g-1 (simulator-controller, simulator-controller-dev).
#
# Usage:
#   ./scripts/restart-lab-from-source.sh
#   ./scripts/restart-lab-from-source.sh --dev-mode=fast --with-prometheus
#   ./scripts/restart-lab-from-source.sh --dry-run
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROLLER="${ROOT}/SimulatorController"
REGISTRY="${ROOT}/a2a-registry"
PROXY="${ROOT}/IntentReportQueryProxy"
PROMETHEUS="${ROOT}/Prometheus"

SKIP_AGENTS=0
SKIP_REGISTRY=0
SKIP_PROXY=0
SKIP_PROD=0
SKIP_DEV=0
WITH_PROMETHEUS=0
NO_SYSTEMD=0
DEV_MODE=""
DRY_RUN=0

AGENT_KEY_NAMES=(
  "5g4data-intent-generating-agent"
  "5g4data-intent-observation-generating-agent"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Restart agents, registry, proxy, and prod/dev SimulatorController from current repo source.

Options:
  --skip-agents       Skip agent reload (./agent-control reload)
  --skip-registry     Skip a2a-registry start/restart
  --skip-proxy        Skip IntentReportQueryProxy restart
  --skip-prod         Skip prod Controller (port 3000)
  --skip-dev          Skip dev Controller (port 3001)
  --with-prometheus   Restart Prometheus stack (Prometheus/stop.sh + start.sh)
  --no-systemd        Never use systemctl; start Controllers manually in background
  --dev-mode=MODE     Dev start: systemd (default), fast (next start :3001), hot (next dev :3001)
  --dry-run           Print commands without executing
  -h, --help          Show this help

Examples:
  $(basename "$0")
  $(basename "$0") --dev-mode=fast --with-prometheus
  $(basename "$0") --skip-prod --no-systemd
EOF
}

for arg in "$@"; do
  case "$arg" in
    --skip-agents) SKIP_AGENTS=1 ;;
    --skip-registry) SKIP_REGISTRY=1 ;;
    --skip-proxy) SKIP_PROXY=1 ;;
    --skip-prod) SKIP_PROD=1 ;;
    --skip-dev) SKIP_DEV=1 ;;
    --with-prometheus) WITH_PROMETHEUS=1 ;;
    --no-systemd) NO_SYSTEMD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --dev-mode=*) DEV_MODE="${arg#--dev-mode=}" ;;
    -h|--help|help) usage; exit 0 ;;
    *)
      echo "ERROR: unknown option: ${arg}" >&2
      usage >&2
      exit 1
      ;;
  esac
done

run() {
  if (( DRY_RUN )); then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

require_commands() {
  local cmd
  for cmd in docker npm curl; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "ERROR: required command not found: ${cmd}" >&2
      exit 1
    fi
  done
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: docker compose is not available" >&2
    exit 1
  fi
}

systemd_unit_exists() {
  local unit="$1"
  systemctl cat "$unit" >/dev/null 2>&1
}

systemd_unit_enabled() {
  local unit="$1"
  systemctl is-enabled "$unit" >/dev/null 2>&1
}

free_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    if fuser "${port}/tcp" >/dev/null 2>&1; then
      echo "    Freeing port ${port} ..."
      if (( DRY_RUN )); then
        echo "[dry-run] fuser -k ${port}/tcp"
      else
        fuser -k "${port}/tcp" >/dev/null 2>&1 || sudo fuser -k "${port}/tcp" >/dev/null 2>&1 || true
      fi
    fi
  fi
}

stop_controllers() {
  echo "==> Stopping Controllers (prod :3000, dev :3001)"

  if (( NO_SYSTEMD )); then
    echo "    (--no-systemd: skipping systemctl stop)"
  elif command -v systemctl >/dev/null 2>&1; then
    if (( ! SKIP_PROD )) && systemd_unit_exists simulator-controller.service; then
      run sudo systemctl stop simulator-controller || true
    fi
    if (( ! SKIP_DEV )) && systemd_unit_exists simulator-controller-dev.service; then
      run sudo systemctl stop simulator-controller-dev || true
    fi
  fi

  if (( ! SKIP_PROD )); then
    free_port 3000
  fi
  if (( ! SKIP_DEV )); then
    free_port 3001
  fi
}

reload_agents() {
  echo "==> Force-reloading simulator agents (preserves AGENT_API_KEYS from SimulatorController/.env)"
  run "${ROOT}/agent-control" reload
}

restart_a2a_registry() {
  echo "==> Starting/restarting a2a-registry (reload AGENT_API_KEYS from backend/.env)"
  if [[ ! -f "${REGISTRY}/docker-compose.yml" ]]; then
    echo "    Skipped: ${REGISTRY}/docker-compose.yml not found"
    return 0
  fi
  if (( DRY_RUN )); then
    echo "[dry-run] cd ${REGISTRY} && docker compose up -d"
    echo "[dry-run] cd ${REGISTRY} && docker compose restart api worker"
    echo "[dry-run] wait for http://127.0.0.1:17001/health"
  else
    (cd "$REGISTRY" && docker compose up -d)
    (cd "$REGISTRY" && docker compose restart api worker)
    wait_for_http_health "http://127.0.0.1:17001/health" "a2a-registry" 120
  fi
}

restart_intent_proxy() {
  echo "==> Restarting IntentReportQueryProxy"
  if [[ ! -f "${PROXY}/docker-compose.yml" ]]; then
    echo "    Skipped: ${PROXY}/docker-compose.yml not found"
    return 0
  fi
  if (( DRY_RUN )); then
    echo "[dry-run] cd ${PROXY} && docker compose up -d"
  else
    (cd "$PROXY" && docker compose up -d)
  fi
}

restart_prometheus() {
  echo "==> Restarting Prometheus stack"
  if [[ ! -x "${PROMETHEUS}/start.sh" ]]; then
    echo "    Skipped: ${PROMETHEUS}/start.sh not found"
    return 0
  fi
  if [[ -x "${PROMETHEUS}/stop.sh" ]]; then
    run "${PROMETHEUS}/stop.sh"
  fi
  run "${PROMETHEUS}/start.sh"
}

build_controllers() {
  echo "==> Building SimulatorController"
  if [[ ! -f "${CONTROLLER}/package.json" ]]; then
    echo "ERROR: ${CONTROLLER} not found" >&2
    exit 1
  fi

  if (( DRY_RUN )); then
    echo "[dry-run] cd ${CONTROLLER} && npm install (if needed) && npm run prisma:generate && npm run build"
    if (( ! SKIP_DEV )); then
      echo "[dry-run] cd ${CONTROLLER} && npm run dev:lab:build"
    fi
    return 0
  fi

  (
    cd "$CONTROLLER"
    if [[ ! -d node_modules ]]; then
      echo "    Installing npm dependencies ..."
      npm install
    fi
    if grep -q '"prisma:generate"' package.json 2>/dev/null; then
      echo "    prisma generate ..."
      npm run prisma:generate
    fi
    if (( ! SKIP_PROD )); then
      echo "    npm run build (prod) ..."
      npm run build
    fi
    if (( ! SKIP_DEV )); then
      if [[ ! -f .env.dev ]]; then
        echo "ERROR: missing ${CONTROLLER}/.env.dev (copy from .env.dev.example)" >&2
        exit 1
      fi
      echo "    npm run dev:lab:build (dev :3001) ..."
      npm run dev:lab:build
    fi
  )
}

resolve_dev_mode() {
  if [[ -n "$DEV_MODE" ]]; then
    printf '%s\n' "$DEV_MODE"
    return 0
  fi
  if (( NO_SYSTEMD )); then
    printf '%s\n' "fast"
    return 0
  fi
  if command -v systemctl >/dev/null 2>&1 && systemd_unit_enabled simulator-controller-dev.service; then
    printf '%s\n' "systemd"
    return 0
  fi
  printf '%s\n' "fast"
}

start_controller_manual() {
  local label="$1"
  local port="$2"
  local log_dir="${CONTROLLER}/logs"
  local log_file="${log_dir}/restart-lab-${port}.log"
  local cmd="$3"

  mkdir -p "$log_dir"
  echo "    Starting ${label} on port ${port} (background, log: ${log_file})"
  if (( DRY_RUN )); then
    echo "[dry-run] cd ${CONTROLLER} && nohup ${cmd} >> ${log_file} 2>&1 &"
    return 0
  fi
  (
    cd "$CONTROLLER"
    nohup bash -c "$cmd" >>"$log_file" 2>&1 &
  )
}

start_controllers() {
  echo "==> Starting Controllers"
  local dev_mode
  dev_mode="$(resolve_dev_mode)"
  echo "    Dev mode: ${dev_mode}"

  if (( ! SKIP_PROD )); then
    if (( NO_SYSTEMD )) || ! systemd_unit_enabled simulator-controller.service; then
      start_controller_manual "prod Controller" 3000 \
        "npm run start -- -H 0.0.0.0 -p 3000"
    else
      run sudo systemctl start simulator-controller
    fi
  fi

  if (( ! SKIP_DEV )); then
    case "$dev_mode" in
      systemd)
        if systemd_unit_enabled simulator-controller-dev.service; then
          run sudo systemctl start simulator-controller-dev
        else
          echo "ERROR: simulator-controller-dev.service not enabled; use --dev-mode=fast or --no-systemd" >&2
          exit 1
        fi
        ;;
      fast)
        start_controller_manual "dev Controller (fast)" 3001 "npm run dev:lab:fast"
        ;;
      hot)
        start_controller_manual "dev Controller (hot)" 3001 "npm run dev:lab"
        ;;
      *)
        echo "ERROR: invalid --dev-mode=${dev_mode} (use systemd, fast, or hot)" >&2
        exit 1
        ;;
    esac
  fi
}

wait_for_http_health() {
  local url="$1"
  local label="$2"
  local max_secs="${3:-60}"
  if (( DRY_RUN )); then
    echo "[dry-run] wait for ${label} at ${url}"
    return 0
  fi
  echo "    Waiting for ${label} at ${url} ..."
  for _ in $(seq 1 "$max_secs"); do
    if curl -sf --connect-timeout 2 "$url" >/dev/null 2>&1; then
      echo "    OK: ${label} healthy"
      return 0
    fi
    sleep 1
  done
  echo "WARNING: ${label} not healthy at ${url} within ${max_secs}s" >&2
  return 1
}

wait_for_tcp_port() {
  local port="$1"
  local label="$2"
  local url="tcp://127.0.0.1:${port}"
  if (( DRY_RUN )); then
    echo "[dry-run] wait for ${label} on port ${port}"
    return 0
  fi
  echo "    Waiting for ${label} on port ${port} ..."
  for _ in $(seq 1 90); do
    if curl -sf --connect-timeout 1 "http://127.0.0.1:${port}/" >/dev/null 2>&1 \
      || ss -tln 2>/dev/null | grep -q ":${port} "; then
      echo "    OK: ${label} listening on ${port}"
      return 0
    fi
    sleep 1
  done
  echo "WARNING: ${label} did not listen on port ${port} within 90s" >&2
  return 1
}

extract_agent_api_keys_fingerprint() {
  local env_file="$1"
  python3 - "$env_file" "${AGENT_KEY_NAMES[@]}" <<'PY'
import json
import re
import sys

path = sys.argv[1]
names = sys.argv[2:]

try:
    text = open(path, encoding="utf-8").read()
except OSError:
    print("MISSING")
    sys.exit(0)

m = re.search(r"^AGENT_API_KEYS=(.*)$", text, re.MULTILINE)
if not m:
    print("NO_KEYS")
    sys.exit(0)

raw = m.group(1).strip()
if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
    raw = raw[1:-1]
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("PARSE_ERROR")
    sys.exit(0)

parts = []
for name in names:
    key = data.get(name, "")
    if not key:
        parts.append(f"{name}:MISSING")
    else:
        parts.append(f"{name}:{key[:8]}...")
print("|".join(parts))
PY
}

agent_api_keys_canonical() {
  local env_file="$1"
  python3 - "$env_file" "${AGENT_KEY_NAMES[@]}" <<'PY'
import json
import re
import sys

path = sys.argv[1]
names = sys.argv[2:]

try:
    text = open(path, encoding="utf-8").read()
except OSError:
    sys.exit(1)

m = re.search(r"^AGENT_API_KEYS=(.*)$", text, re.MULTILINE)
if not m:
    sys.exit(1)

raw = m.group(1).strip()
if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
    raw = raw[1:-1]
data = json.loads(raw)
subset = {n: data.get(n, "") for n in names}
if not all(subset.values()):
    sys.exit(1)
print(json.dumps(subset, sort_keys=True))
PY
}

verify_agent_api_keys_sync() {
  echo "==> Verifying AGENT_API_KEYS sync (fingerprints only, not full secrets)"
  local -a files=()
  local controller_env="${CONTROLLER}/.env"
  local controller_dev="${CONTROLLER}/.env.dev"
  local registry_env="${REGISTRY}/backend/.env"

  [[ -f "$controller_env" ]] && files+=("$controller_env")
  [[ -f "$controller_dev" ]] && files+=("$controller_dev")
  [[ -f "$registry_env" ]] && files+=("$registry_env")

  if ((${#files[@]} == 0)); then
    echo "WARNING: no consumer .env files found for key sync check" >&2
    return 1
  fi

  local reference=""
  local reference_file=""
  local file fp canonical
  local ok=1
  for file in "${files[@]}"; do
    fp="$(extract_agent_api_keys_fingerprint "$file")"
    echo "    $(basename "$(dirname "$file")")/$(basename "$file"): ${fp}"
    if [[ "$fp" == *"MISSING"* || "$fp" == "NO_KEYS" || "$fp" == "PARSE_ERROR" ]]; then
      ok=0
      continue
    fi
    if ! canonical="$(agent_api_keys_canonical "$file" 2>/dev/null)"; then
      ok=0
      continue
    fi
    if [[ -z "$reference" ]]; then
      reference="$canonical"
      reference_file="$file"
    elif [[ "$canonical" != "$reference" ]]; then
      echo "WARNING: AGENT_API_KEYS mismatch vs ${reference_file}" >&2
      ok=0
    fi
  done

  if (( ok )); then
    echo "    OK: agent key entries present and consistent across consumer .env files"
  else
    echo "WARNING: fix AGENT_API_KEYS in consumer .env files or re-run ./agent-control reload" >&2
  fi
  return $((1 - ok))
}

verify_services() {
  echo "==> Verifying services"
  local failed=0

  if (( ! SKIP_AGENTS )); then
    for port in 3011 3012; do
      if (( DRY_RUN )); then
        echo "[dry-run] curl -sf http://127.0.0.1:${port}/health"
      elif ! curl -sf "http://127.0.0.1:${port}/health" >/dev/null; then
        echo "WARNING: agent health failed on port ${port}" >&2
        failed=1
      else
        echo "    OK: agent http://127.0.0.1:${port}/health"
      fi
    done
  fi

  if (( ! SKIP_REGISTRY )); then
    if (( DRY_RUN )); then
      echo "[dry-run] curl -sf http://127.0.0.1:17001/health"
    elif curl -sf "http://127.0.0.1:17001/health" >/dev/null 2>&1; then
      echo "    OK: a2a-registry http://127.0.0.1:17001/health"
    else
      echo "WARNING: a2a-registry health check failed (see: cd ${REGISTRY} && docker compose ps)" >&2
      failed=1
    fi
  fi

  if (( ! SKIP_PROXY )); then
    if (( DRY_RUN )); then
      echo "[dry-run] curl -sf http://127.0.0.1:3010/health"
    elif curl -sf "http://127.0.0.1:3010/health" >/dev/null 2>&1; then
      echo "    OK: IntentReportQueryProxy http://127.0.0.1:3010/health"
    else
      echo "WARNING: IntentReportQueryProxy health check failed" >&2
      failed=1
    fi
  fi

  if (( ! SKIP_PROD )); then
    wait_for_tcp_port 3000 "prod Controller" || failed=1
  fi
  if (( ! SKIP_DEV )); then
    wait_for_tcp_port 3001 "dev Controller" || failed=1
  fi

  if (( ! SKIP_AGENTS )); then
    verify_agent_api_keys_sync || failed=1
  fi

  if (( failed )); then
    echo ""
    echo "Some checks failed. Inspect logs:"
    echo "  journalctl -u simulator-controller -u simulator-controller-dev -n 50 --no-pager"
    echo "  ${CONTROLLER}/logs/restart-lab-*.log"
    return 1
  fi
  return 0
}

main() {
  require_commands

  echo "Restarting AgenticDataSimulator lab from ${ROOT}"
  if (( DRY_RUN )); then
    echo "(dry-run mode — no changes applied)"
  fi
  echo ""

  if (( ! SKIP_PROD || ! SKIP_DEV )); then
    stop_controllers
    echo ""
  fi

  if (( ! SKIP_AGENTS )); then
    reload_agents
    echo ""
  fi

  if (( ! SKIP_REGISTRY )); then
    restart_a2a_registry
    echo ""
  fi

  if (( ! SKIP_PROXY )); then
    restart_intent_proxy
    echo ""
  fi

  if (( WITH_PROMETHEUS )); then
    restart_prometheus
    echo ""
  fi

  if (( ! SKIP_PROD || ! SKIP_DEV )); then
    build_controllers
    echo ""
    start_controllers
    echo ""
  fi

  verify_services || exit 1

  echo ""
  echo "Lab restart complete."
}

main "$@"
