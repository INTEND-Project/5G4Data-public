#!/bin/bash
# Setup script for inOrch minikube cluster with proper DNS configuration

set -e

PROFILE="inOrch"

echo "=== Setting up inOrch minikube cluster ==="

# Step 1: Start minikube
echo ""
echo "Step 1: Starting minikube cluster..."
minikube start --driver=docker --cpus=16 --memory=24G -p $PROFILE

# Step 2: Wait for CoreDNS to be ready
echo ""
echo "Step 2: Waiting for CoreDNS to be ready..."
kubectl wait --for=condition=ready pod -l k8s-app=kube-dns -n kube-system --timeout=120s

# Step 3: Configure CoreDNS to use working DNS servers
echo ""
echo "Step 3: Configuring CoreDNS DNS forwarding..."

# Get your host DNS servers (fallback to known working ones)
HOST_DNS=$(grep nameserver /etc/resolv.conf | awk '{print $2}' | head -3 | tr '\n' ' ' || echo "129.242.9.253 158.38.0.1 129.242.4.254")

# Use known working DNS servers for this environment
DNS_SERVERS="129.242.9.253 158.38.0.1 129.242.4.254"

# Create CoreDNS config with direct DNS forwarding
cat > /tmp/coredns-fixed.yaml <<EOF
apiVersion: v1
data:
  Corefile: |
    .:53 {
        log
        errors
        health {
           lameduck 5s
        }
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
           ttl 30
        }
        prometheus :9153
        hosts {
           192.168.49.1 host.minikube.internal
           fallthrough
        }
        forward . ${DNS_SERVERS} {
           max_concurrent 1000
        }
        cache 30 {
           disable success cluster.local
           disable denial cluster.local
        }
        loop
        reload
        loadbalance
    }
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
EOF

kubectl apply -f /tmp/coredns-fixed.yaml

# Step 4: Restart CoreDNS to apply new config
echo ""
echo "Step 4: Restarting CoreDNS..."
kubectl rollout restart deployment/coredns -n kube-system
kubectl rollout status deployment/coredns -n kube-system --timeout=60s

# Step 5: Verify DNS is working
echo ""
echo "Step 5: Verifying DNS resolution..."
sleep 5

# Test DNS resolution from a temporary pod
if kubectl run dns-test --image=busybox --rm -i --restart=Never -- nslookup start5g-1.cs.uit.no 2>&1 | grep -q "can't resolve"; then
    echo "WARNING: DNS resolution test failed, but continuing..."
else
    echo "DNS resolution test passed!"
fi

# Clean up temp file
rm -f /tmp/coredns-fixed.yaml

echo ""
echo "=== Cluster setup complete! ==="
echo ""
echo "Next steps:"
echo "1. Install IDO (if needed):"
echo "   kubectl create namespace ido"
echo "   kubectl apply -f <IDO_ARTEFACTS>/intents_crds_v1alpha1.yaml"
echo "   kubectl apply -f <IDO_ARTEFACTS>/deploy/manifest.yaml"
echo ""
echo "2. Run ./build-and-deploy.sh to deploy inServ"
echo ""
echo "3. Create ghcr-creds secret in inserv namespace:"
echo "   kubectl -n inserv create secret docker-registry ghcr-creds \\"
echo "     --docker-server=ghcr.io \\"
echo "     --docker-username=<your-github-user> \\"
echo "     --docker-password='<GITHUB_PAT>' \\"
echo "     --docker-email=you@example.com"

