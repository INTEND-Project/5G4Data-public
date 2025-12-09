#!/bin/bash
# Script to set up port forwarding for ingress controller NodePort
# This allows external access to the ingress controller via the host's external IP
# Uses socat for reliable TCP proxying

set -e

# Accept INGRESS_NODEPORT from environment variable or use default
INGRESS_NODEPORT="${INGRESS_NODEPORT:-30872}"
MINIKUBE_IP="192.168.49.2"
HOST_EXTERNAL_IP="129.242.22.51"
SERVICE_NAME="ingress-forwarding-${INGRESS_NODEPORT}"

echo "Setting up port forwarding for ingress controller..."
echo "Forwarding port $INGRESS_NODEPORT from $HOST_EXTERNAL_IP to minikube node ($MINIKUBE_IP:$INGRESS_NODEPORT)"

# Check if socat is installed
if ! command -v socat >/dev/null 2>&1; then
    echo "✗ Error: socat is not installed"
    echo "  Please install it with: sudo apt-get install socat"
    exit 1
fi

# Stop any existing socat process for this port
echo "Stopping any existing forwarding processes..."
sudo pkill -f "socat.*${INGRESS_NODEPORT}" 2>/dev/null || true
sleep 1

# Create systemd service for persistent forwarding
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
echo "Creating systemd service: $SERVICE_FILE"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Port forwarding for ingress controller NodePort ${INGRESS_NODEPORT}
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/socat TCP-LISTEN:${INGRESS_NODEPORT},fork,reuseaddr,bind=${HOST_EXTERNAL_IP} TCP:${MINIKUBE_IP}:${INGRESS_NODEPORT}
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable/start the service
echo "Enabling and starting the service..."
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"

# Wait a moment for the service to start
sleep 2

# Verify the service is running
if sudo systemctl is-active --quiet "${SERVICE_NAME}.service"; then
    echo "✓ Service is running"
    
    # Verify socat is listening
    if sudo netstat -tlnp 2>/dev/null | grep -q ":${INGRESS_NODEPORT}" || sudo ss -tlnp 2>/dev/null | grep -q ":${INGRESS_NODEPORT}"; then
        echo "✓ Port forwarding is active (listening on ${HOST_EXTERNAL_IP}:${INGRESS_NODEPORT})"
    else
        echo "⚠ Warning: Service is running but port doesn't appear to be listening"
    fi
else
    echo "✗ Error: Service failed to start"
    sudo systemctl status "${SERVICE_NAME}.service" --no-pager -l
    exit 1
fi

# Configure firewall rules to allow traffic
echo "Configuring firewall rules..."

# Enable route_localnet for the external interface
EXTERNAL_INTERFACE=$(ip -o addr show | grep "$HOST_EXTERNAL_IP" | awk '{print $2}' | head -1)
if [ -n "$EXTERNAL_INTERFACE" ]; then
    SYSCTL_CMD=$(command -v sysctl || echo "/sbin/sysctl")
    if [ "$($SYSCTL_CMD -n net.ipv4.conf.${EXTERNAL_INTERFACE}.route_localnet 2>/dev/null)" != "1" ]; then
        echo "Enabling route_localnet for interface $EXTERNAL_INTERFACE..."
        sudo $SYSCTL_CMD -w net.ipv4.conf.${EXTERNAL_INTERFACE}.route_localnet=1
        if ! grep -q "net.ipv4.conf.${EXTERNAL_INTERFACE}.route_localnet" /etc/sysctl.conf 2>/dev/null; then
            echo "net.ipv4.conf.${EXTERNAL_INTERFACE}.route_localnet=1" | sudo tee -a /etc/sysctl.conf > /dev/null
        fi
    fi
fi

# Add firewall rules to ensure traffic reaches socat
# Rule in ufw-not-local to allow local IP traffic
if ! sudo iptables -t filter -C ufw-not-local -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; then
    sudo iptables -t filter -I ufw-not-local 1 -p tcp --dport $INGRESS_NODEPORT -j ACCEPT
    echo "✓ Added rule to ufw-not-local chain"
fi

# Rule in ufw-before-input
if ! sudo iptables -t filter -C ufw-before-input -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; then
    sudo iptables -t filter -I ufw-before-input 1 -p tcp --dport $INGRESS_NODEPORT -j ACCEPT
    echo "✓ Added rule to ufw-before-input chain"
fi

# Direct INPUT rule as fallback
if ! sudo iptables -t filter -C INPUT -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; then
    sudo iptables -t filter -I INPUT 1 -p tcp --dport $INGRESS_NODEPORT -j ACCEPT
    echo "✓ Added direct INPUT rule"
fi

echo ""
echo "✓ Port forwarding setup complete!"
echo ""
echo "The ingress controller is now accessible via:"
echo "  http://${HOST_EXTERNAL_IP}:${INGRESS_NODEPORT}/<app-path>/"
echo ""
echo "Example: http://${HOST_EXTERNAL_IP}:${INGRESS_NODEPORT}/hello/"
echo ""
echo "Service management:"
echo "  Status:  sudo systemctl status ${SERVICE_NAME}.service"
echo "  Stop:    sudo systemctl stop ${SERVICE_NAME}.service"
echo "  Start:   sudo systemctl start ${SERVICE_NAME}.service"
echo "  Restart: sudo systemctl restart ${SERVICE_NAME}.service"
