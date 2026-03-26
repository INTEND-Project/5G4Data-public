#!/bin/bash
set -e

# === CONFIGURATION ===
COMPOSE_DIR="/home/telco/arneme/INTEND-Project/5G4Data-public/5G4Data-Tutorial"
LOG_FILE="${COMPOSE_DIR}/certificate-updates.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [deploy-hook] $*" | tee -a "$LOG_FILE"
}

log "=== Starting deploy hook for reverse-proxy reload ==="

# Caddy reads the live certificates directly from /etc/letsencrypt,
# so a restart is enough to pick up renewed certificate files.
log "Restarting reverse-proxy container..."
cd "${COMPOSE_DIR}" || { log "ERROR: Cannot cd to ${COMPOSE_DIR}"; exit 1; }

if docker compose restart reverse-proxy; then
    log "Reverse-proxy container restarted successfully."
else
    log "ERROR: Reverse-proxy restart failed."
    exit 1
fi

log "Deploy hook completed successfully."
