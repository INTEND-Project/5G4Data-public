#!/usr/bin/env bash
# Enable Grafana JWT URL login for SimulatorController dashboard links (auth_token query param).
#
# Usage:
#   ./Grafana/configure-jwt-auth.sh              # restart grafana-3002-dev
#   ./Grafana/configure-jwt-auth.sh --no-restart   # only write jwks file
#
# Reads GRAFANA_JWT_SECRET from SimulatorController/.env (or generates one).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTROLLER_ENV="${ROOT}/SimulatorController/.env"
JWKS_FILE="${SCRIPT_DIR}/jwt-jwks.json"
CONTAINER_NAME="${GRAFANA_CONTAINER_NAME:-grafana-3002-dev}"

NO_RESTART=false
if [[ "${1:-}" == "--no-restart" ]]; then
  NO_RESTART=true
fi

if [[ ! -f "${CONTROLLER_ENV}" ]]; then
  echo "error: missing ${CONTROLLER_ENV}" >&2
  exit 1
fi

read_env_var() {
  local key="$1"
  grep -E "^[[:space:]]*${key}=" "${CONTROLLER_ENV}" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^["'\'' ]*//' -e 's/["'\'' ]*$//' || true
}

SECRET="$(read_env_var GRAFANA_JWT_SECRET)"
if [[ -z "${SECRET}" ]]; then
  SECRET="$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)"
  echo "GRAFANA_JWT_SECRET=\"${SECRET}\"" >> "${CONTROLLER_ENV}"
  echo "Appended GRAFANA_JWT_SECRET to ${CONTROLLER_ENV}"
fi

node -e "
const { writeFileSync } = require('fs');
const secret = process.argv[1];
const k = Buffer.from(secret, 'utf8').toString('base64').replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const jwks = { keys: [{ kty: 'oct', kid: 'simulator-controller', alg: 'HS256', use: 'sig', k }] };
writeFileSync(process.argv[2], JSON.stringify(jwks, null, 2) + '\\n');
" "${SECRET}" "${JWKS_FILE}"

echo "Wrote ${JWKS_FILE}"

if [[ "${NO_RESTART}" == true ]]; then
  exit 0
fi

if ! docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "error: container ${CONTAINER_NAME} not found" >&2
  exit 1
fi

docker stop "${CONTAINER_NAME}" >/dev/null

# Preserve existing volume mount and image; add JWT settings.
IMAGE="$(docker inspect "${CONTAINER_NAME}" --format '{{.Config.Image}}')"
VOLUME="$(docker inspect "${CONTAINER_NAME}" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/grafana"}}{{.Name}}{{end}}{{end}}')"

docker rm "${CONTAINER_NAME}" >/dev/null

CONTAINER_ID="$(docker run -d \
  --network=host \
  --name="${CONTAINER_NAME}" \
  -e GF_SERVER_HTTP_PORT=3002 \
  -e GF_SERVER_HTTP_ADDR=0.0.0.0 \
  -e GF_SERVER_ROOT_URL=http://localhost:3002/ \
  -e GF_SECURITY_ADMIN_PASSWORD="$(read_env_var GRAFANA_ADMIN_PASSWORD)" \
  -e GF_PANELS_ENABLE_ALPHA=true \
  -e GF_AUTH_JWT_ENABLED=true \
  -e GF_AUTH_JWT_URL_LOGIN=true \
  -e GF_AUTH_JWT_AUTO_SIGN_UP=true \
  -e GF_AUTH_JWT_HEADER_NAME=X-JWT-Assertion \
  -e GF_AUTH_JWT_USERNAME_CLAIM=sub \
  -e GF_AUTH_JWT_EMAIL_CLAIM=email \
  -e GF_AUTH_JWT_JWK_SET_FILE=/etc/grafana/jwt-jwks.json \
  -e GF_AUTH_JWT_KEY_ID=simulator-controller \
  -e GF_AUTH_ANONYMOUS_ENABLED=true \
  -e GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer \
  -v "${JWKS_FILE}:/etc/grafana/jwt-jwks.json:ro" \
  -v "${VOLUME}:/var/lib/grafana" \
  "${IMAGE}")"

echo "Started ${CONTAINER_NAME} (${CONTAINER_ID}) with JWT URL login and anonymous Viewer access."
echo "Set the same GRAFANA_JWT_SECRET in SimulatorController/.env and restart the Controller."
