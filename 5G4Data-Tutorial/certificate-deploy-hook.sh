#!/bin/bash
set -e

# === CONFIGURATION ===
DOMAIN="start5g-1.cs.uit.no"
SRC_DIR="/etc/letsencrypt/live/${DOMAIN}"
DEST_DIR="/home/telco/arneme/INTEND-Project/5G4Data-public/5G4Data-Tutorial/certs"
COMPOSE_DIR="/home/telco/arneme/INTEND-Project/5G4Data-public/5G4Data-Tutorial"
LOG_FILE="${COMPOSE_DIR}/certificate-updates.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [deploy-hook] $*" | tee -a "$LOG_FILE"
}

log "=== Starting deploy hook for ${DOMAIN} ==="

# 1. Copy new certificates to target folder
log "Copying new certificates..."
if cp -L "${SRC_DIR}/fullchain.pem" "${DEST_DIR}/fullchain.pem" && \
   cp -L "${SRC_DIR}/privkey.pem" "${DEST_DIR}/privkey.pem"; then
    chmod 644 "${DEST_DIR}/fullchain.pem"
    chmod 600 "${DEST_DIR}/privkey.pem"
    log "Certificates copied successfully."
else
    log "ERROR: Failed to copy certificate files from ${SRC_DIR}"
    exit 1
fi

# 2. Restart docker-compose stack
log "Restarting containers..."
cd "${COMPOSE_DIR}" || { log "ERROR: Cannot cd to ${COMPOSE_DIR}"; exit 1; }

if docker compose down && docker compose up -d --build; then
    log "Docker containers restarted successfully."
else
    log "ERROR: Docker restart failed."
    exit 1
fi

log "Deploy hook completed successfully."
