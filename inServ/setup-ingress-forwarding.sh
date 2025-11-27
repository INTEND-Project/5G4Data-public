#!/bin/bash
# Script to set up iptables forwarding for ingress controller NodePort
# This allows external access to the ingress controller via the host's external IP

set -e

INGRESS_NODEPORT=30872
MINIKUBE_IP="192.168.49.2"
HOST_EXTERNAL_IP="129.242.22.51"

echo "Setting up iptables forwarding for ingress controller..."
echo "Forwarding port $INGRESS_NODEPORT from host to minikube node ($MINIKUBE_IP:$INGRESS_NODEPORT)"

# Check if rules already exist
if sudo iptables -t nat -C PREROUTING -p tcp --dport $INGRESS_NODEPORT -j DNAT --to-destination $MINIKUBE_IP:$INGRESS_NODEPORT 2>/dev/null; then
    echo "PREROUTING rule already exists, skipping..."
else
    sudo iptables -t nat -A PREROUTING -p tcp --dport $INGRESS_NODEPORT -j DNAT --to-destination $MINIKUBE_IP:$INGRESS_NODEPORT
    echo "✓ Added PREROUTING rule"
fi

if sudo iptables -t nat -C OUTPUT -p tcp --dport $INGRESS_NODEPORT -d $HOST_EXTERNAL_IP -j DNAT --to-destination $MINIKUBE_IP:$INGRESS_NODEPORT 2>/dev/null; then
    echo "OUTPUT rule already exists, skipping..."
else
    sudo iptables -t nat -A OUTPUT -p tcp --dport $INGRESS_NODEPORT -d $HOST_EXTERNAL_IP -j DNAT --to-destination $MINIKUBE_IP:$INGRESS_NODEPORT
    echo "✓ Added OUTPUT rule"
fi

# Ensure FORWARD rule allows the traffic
if sudo iptables -t filter -C FORWARD -p tcp -d $MINIKUBE_IP --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; then
    echo "FORWARD rule already exists, skipping..."
else
    sudo iptables -t filter -I FORWARD 1 -p tcp -d $MINIKUBE_IP --dport $INGRESS_NODEPORT -j ACCEPT
    echo "✓ Added FORWARD rule"
fi

# Make rules persistent (save to /etc/iptables/rules.v4 if netfilter-persistent is installed)
if command -v netfilter-persistent >/dev/null 2>&1; then
    echo "Saving iptables rules to make them persistent..."
    sudo netfilter-persistent save
    echo "✓ Rules saved (will persist across reboots)"
elif [ -d /etc/iptables ]; then
    echo "Saving iptables rules to /etc/iptables/rules.v4..."
    sudo mkdir -p /etc/iptables
    sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null
    echo "✓ Rules saved to /etc/iptables/rules.v4"
    echo "  Note: You may need to configure your system to load these rules on boot"
else
    echo "⚠ Warning: netfilter-persistent not found. Rules are temporary and will be lost on reboot."
    echo "  To make them persistent, install netfilter-persistent: sudo apt-get install iptables-persistent"
fi

echo ""
echo "✓ Ingress forwarding setup complete!"
echo ""
echo "The ingress controller is now accessible via:"
echo "  http://$HOST_EXTERNAL_IP:$INGRESS_NODEPORT/<app-path>/"
echo ""
echo "Example: http://$HOST_EXTERNAL_IP:$INGRESS_NODEPORT/hello/"

