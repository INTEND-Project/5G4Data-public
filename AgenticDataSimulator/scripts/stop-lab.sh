#!/usr/bin/env bash
# Stop the AgenticDataSimulator lab started by complete-restart-lab-from-source.sh:
#   - prod (3000) and dev (3001) Controllers
#   - simulator agents (./agent-control stop)
#   - IntentReportQueryProxy and a2a-registry docker stacks
#   - optionally Prometheus (Prometheus/stop.sh)
#
# Systemd steps use sudo on start5g-1 (simulator-controller, simulator-controller-dev).
#
# Usage:
#   ./scripts/stop-lab.sh
#   ./scripts/stop-lab.sh --with-prometheus
#   ./scripts/stop-lab.sh --dry-run
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Stop prod/dev SimulatorController, agents, registry, proxy, and optionally Prometheus.

Options:
  --skip-agents       Skip agent stop (./agent-control stop)
  --skip-registry     Skip a2a-registry docker compose down
  --skip-proxy        Skip IntentReportQueryProxy docker compose down
  --skip-prod         Skip prod Controller (port 3000)
  --skip-dev          Skip dev Controller (port 3001)
  --with-prometheus   Stop Prometheus stack (Prometheus/stop.sh)
  --no-systemd        Never use systemctl; only free Controller ports
  --dry-run           Print commands without executing
  -h, --help          Show this help

Examples:
  $(basename "$0")
  $(basename "$0") --with-prometheus
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
  for cmd in docker; do
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

stop_agents() {
  echo "==> Stopping simulator agents"
  run "${ROOT}/agent-control" stop
}

stop_intent_proxy() {
  echo "==> Stopping IntentReportQueryProxy"
  if [[ ! -f "${PROXY}/docker-compose.yml" ]]; then
    echo "    Skipped: ${PROXY}/docker-compose.yml not found"
    return 0
  fi
  if (( DRY_RUN )); then
    echo "[dry-run] cd ${PROXY} && docker compose down"
  else
    (cd "$PROXY" && docker compose down) || true
  fi
}

stop_a2a_registry() {
  echo "==> Stopping a2a-registry"
  if [[ ! -f "${REGISTRY}/docker-compose.yml" ]]; then
    echo "    Skipped: ${REGISTRY}/docker-compose.yml not found"
    return 0
  fi
  if (( DRY_RUN )); then
    echo "[dry-run] cd ${REGISTRY} && docker compose down"
  else
    (cd "$REGISTRY" && docker compose down) || true
  fi
}

stop_prometheus() {
  echo "==> Stopping Prometheus stack"
  if [[ ! -x "${PROMETHEUS}/stop.sh" ]]; then
    echo "    Skipped: ${PROMETHEUS}/stop.sh not found"
    return 0
  fi
  run "${PROMETHEUS}/stop.sh"
}

verify_stopped() {
  echo "==> Verifying lab is stopped"
  local failed=0

  if (( ! SKIP_PROD )); then
    if (( DRY_RUN )); then
      echo "[dry-run] check port 3000 is free"
    elif ss -tln 2>/dev/null | grep -q ":3000 "; then
      echo "WARNING: prod Controller still listening on port 3000" >&2
      failed=1
    else
      echo "    OK: port 3000 free"
    fi
  fi

  if (( ! SKIP_DEV )); then
    if (( DRY_RUN )); then
      echo "[dry-run] check port 3001 is free"
    elif ss -tln 2>/dev/null | grep -q ":3001 "; then
      echo "WARNING: dev Controller still listening on port 3001" >&2
      failed=1
    else
      echo "    OK: port 3001 free"
    fi
  fi

  if (( ! SKIP_AGENTS )); then
    for port in 3011 3012; do
      if (( DRY_RUN )); then
        echo "[dry-run] check port ${port} is free"
      elif ss -tln 2>/dev/null | grep -q ":${port} "; then
        echo "WARNING: agent still listening on port ${port}" >&2
        failed=1
      else
        echo "    OK: port ${port} free"
      fi
    done
  fi

  if (( ! SKIP_PROXY )); then
    if (( DRY_RUN )); then
      echo "[dry-run] check port 3010 is free"
    elif ss -tln 2>/dev/null | grep -q ":3010 "; then
      echo "WARNING: IntentReportQueryProxy still listening on port 3010" >&2
      failed=1
    else
      echo "    OK: port 3010 free"
    fi
  fi

  if (( ! SKIP_REGISTRY )); then
    if (( DRY_RUN )); then
      echo "[dry-run] check port 17001 is free"
    elif ss -tln 2>/dev/null | grep -q ":17001 "; then
      echo "WARNING: a2a-registry still listening on port 17001" >&2
      failed=1
    else
      echo "    OK: port 17001 free"
    fi
  fi

  if (( WITH_PROMETHEUS )); then
    for port in 9090 9091; do
      if (( DRY_RUN )); then
        echo "[dry-run] check port ${port} is free"
      elif ss -tln 2>/dev/null | grep -q ":${port} "; then
        echo "WARNING: Prometheus stack still listening on port ${port}" >&2
        failed=1
      else
        echo "    OK: port ${port} free"
      fi
    done
  fi

  if (( failed )); then
    echo ""
    echo "Some services may still be running. Inspect:"
    echo "  systemctl status simulator-controller simulator-controller-dev"
    echo "  docker ps"
    return 1
  fi
  return 0
}

main() {
  require_commands

  echo "Stopping AgenticDataSimulator lab from ${ROOT}"
  if (( DRY_RUN )); then
    echo "(dry-run mode — no changes applied)"
  fi
  echo ""

  if (( ! SKIP_PROD || ! SKIP_DEV )); then
    stop_controllers
    echo ""
  fi

  if (( ! SKIP_AGENTS )); then
    stop_agents
    echo ""
  fi

  if (( ! SKIP_PROXY )); then
    stop_intent_proxy
    echo ""
  fi

  if (( ! SKIP_REGISTRY )); then
    stop_a2a_registry
    echo ""
  fi

  if (( WITH_PROMETHEUS )); then
    stop_prometheus
    echo ""
  fi

  verify_stopped || exit 1

  echo ""
  echo "Lab stop complete."
  echo "Restart with: ./scripts/complete-restart-lab-from-source.sh"
}

main "$@"
