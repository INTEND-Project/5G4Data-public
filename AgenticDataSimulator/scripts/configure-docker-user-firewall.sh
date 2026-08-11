#!/usr/bin/env bash
# Restrict Docker-published lab service ports via the DOCKER-USER chain.
# UFW does not cover Docker DNAT (FORWARD chain); DOCKER-USER does.
# Idempotent — safe to run on every boot (systemd) or after docker restart.
#
# Match host ports with conntrack --ctorigdstport (not --dport): after DNAT the
# destination port is the container port (e.g. 4000:8080 → dport 8080 in FORWARD).
#
# Config: /etc/docker-user-firewall/config (override with CONFIG_FILE=...)
set -euo pipefail

CONFIG_FILE="${CONFIG_FILE:-/etc/docker-user-firewall/config}"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "error: missing config $CONFIG_FILE (see scripts/docker-user-firewall/config.example)" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$CONFIG_FILE"

: "${PRIVATE_CIDRS:?PRIVATE_CIDRS must be set in $CONFIG_FILE}"
: "${RESTRICTED_PORTS:?RESTRICTED_PORTS must be set in $CONFIG_FILE}"
HOME_ALLOW_PORTS="${HOME_ALLOW_PORTS:-()}"

if ! command -v iptables >/dev/null 2>&1; then
  echo "error: iptables is required" >&2
  exit 1
fi

if ! iptables -L DOCKER-USER -n >/dev/null 2>&1; then
  echo "error: DOCKER-USER chain missing — start Docker first" >&2
  exit 1
fi

iptables -F DOCKER-USER

add_rule() {
  iptables -A DOCKER-USER "$@"
}

add_rule -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

for port in "${RESTRICTED_PORTS[@]}"; do
  for cidr in "${PRIVATE_CIDRS[@]}"; do
    add_rule -p tcp -m conntrack --ctorigdstport "$port" -s "$cidr" -j RETURN
  done
  add_rule -p tcp -m conntrack --ctorigdstport "$port" -j DROP
done

# Group HOME_ALLOW_PORTS by host port: allow private ranges + all listed IPs, then DROP once.
home_ports=()
for entry in "${HOME_ALLOW_PORTS[@]}"; do
  port="${entry%%:*}"
  found=0
  for p in "${home_ports[@]}"; do
    if [[ "$p" == "$port" ]]; then
      found=1
      break
    fi
  done
  if (( ! found )); then
    home_ports+=("$port")
  fi
done

for port in "${home_ports[@]}"; do
  for cidr in "${PRIVATE_CIDRS[@]}"; do
    add_rule -p tcp -m conntrack --ctorigdstport "$port" -s "$cidr" -j RETURN
  done
  for entry in "${HOME_ALLOW_PORTS[@]}"; do
    entry_port="${entry%%:*}"
    ip="${entry#*:}"
    if [[ "$entry_port" == "$port" ]]; then
      add_rule -p tcp -m conntrack --ctorigdstport "$port" -s "$ip" -j RETURN
    fi
  done
  add_rule -p tcp -m conntrack --ctorigdstport "$port" -j DROP
done

echo "DOCKER-USER rules applied from $CONFIG_FILE"
echo "  restricted ports: ${RESTRICTED_PORTS[*]}"
if ((${#HOME_ALLOW_PORTS[@]})); then
  echo "  home-allow ports: ${HOME_ALLOW_PORTS[*]}"
fi
