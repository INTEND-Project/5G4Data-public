#!/bin/bash
# Fix DNS in minikube node to use working DNS servers
# This needs to be run after minikube starts

set -e

PROFILE="inOrch-TMF-Proxy"

echo "Fixing DNS in minikube node (profile: $PROFILE)..."

# Update /etc/resolv.conf in minikube node to use working DNS servers
minikube ssh -p $PROFILE -- "sudo bash -c '
cat > /etc/resolv.conf << EOF
nameserver 129.242.9.253
nameserver 158.38.0.1
nameserver 129.242.4.254
EOF
cat /etc/resolv.conf
'"

echo ""
echo "DNS configuration updated. Testing DNS resolution..."
minikube ssh -p $PROFILE -- "nslookup ghcr.io" | head -5

echo ""
echo "✓ DNS fix applied successfully!"

