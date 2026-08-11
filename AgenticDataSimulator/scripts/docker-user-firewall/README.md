# Docker-published port firewall (DOCKER-USER)

Docker bypasses UFW for published ports (`-p host:container`). This setup restricts who can reach those host ports using the `DOCKER-USER` iptables chain.

Rules match the **published host port** via `conntrack --ctorigdstport`, not `--dport` (which is the container port after DNAT). Example: `-p 4000:8080` must use `ctorigdstport 4000`, or traffic would hit rules written for host port `8080` (ChartMuseum).

## Files on the server (after install)

| Path | Purpose |
|------|---------|
| `/etc/docker-user-firewall/config` | Port lists and home IP allowlist (edit this) |
| `/usr/local/sbin/configure-docker-user-firewall.sh` | Applies iptables rules from the config |
| `/etc/systemd/system/docker-user-firewall.service` | Runs the script after Docker starts (boot + docker restarts) |

Repo sources (for upgrades):

| Repo path | Installed to |
|-----------|--------------|
| `scripts/docker-user-firewall/config.example` | `/etc/docker-user-firewall/config` (initial copy) |
| `scripts/configure-docker-user-firewall.sh` | `/usr/local/sbin/configure-docker-user-firewall.sh` |
| `scripts/systemd/docker-user-firewall.service.example` | `/etc/systemd/system/docker-user-firewall.service` |

## Install or upgrade

```bash
cd AgenticDataSimulator
sudo mkdir -p /etc/docker-user-firewall
sudo cp scripts/docker-user-firewall/config.example /etc/docker-user-firewall/config   # skip if config exists
sudo install -m 755 scripts/configure-docker-user-firewall.sh /usr/local/sbin/configure-docker-user-firewall.sh
sudo cp scripts/systemd/docker-user-firewall.service.example /etc/systemd/system/docker-user-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now docker-user-firewall.service
```

## Change ports or home IP

Edit `/etc/docker-user-firewall/config`, then:

```bash
sudo systemctl restart docker-user-firewall.service
```

Multiple remote IPs for the same published port: add one `HOME_ALLOW_PORTS` line per IP (same host port repeated). The script groups allows per port and applies a single DROP at the end.

```bash
HOME_ALLOW_PORTS=(
  "4000:85.165.67.213"   # Open WebUI
  "4000:203.0.113.10"    # Open WebUI — second site
)
```

## Verify

```bash
systemctl status docker-user-firewall.service
sudo iptables -S DOCKER-USER | grep -E 'ctorigdstport (4000|8080|9090|3011|3031)'
```
