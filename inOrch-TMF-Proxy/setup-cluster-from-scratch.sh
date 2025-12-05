#!/bin/bash
# Comprehensive setup script for inOrch-TMF-Proxy from scratch
# Sets up minikube cluster, DNS, ingress, IDO, GHCR credentials, and deploys the proxy

set -e  # Exit on error

# Default configuration
PROFILE="${MINIKUBE_PROFILE:-inOrch-TMF-Proxy}"
NAMESPACE="inorch-tmf-proxy"
IDO_NAMESPACE="ido"
DNS_SERVERS="129.242.9.253 158.38.0.1 129.242.4.254"
GHCR_USERNAME="${GHCR_USERNAME:-arne-munch-ellingsen}"

# Get GHCR password from file or environment variable
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GHCR_PASSWORD_FILE="${GHCR_PASSWORD_FILE:-$SCRIPT_DIR/github-ghrc-pat}"

if [ -z "$GHCR_PASSWORD" ]; then
    if [ -f "$GHCR_PASSWORD_FILE" ]; then
        GHCR_PASSWORD=$(cat "$GHCR_PASSWORD_FILE" | tr -d '\n\r ')
    else
        GHCR_PASSWORD=""
    fi
fi

GHCR_EMAIL="${GHCR_EMAIL:-you@example.com}"

# Flags
SKIP_IDO=false
SKIP_PORT_FORWARD=false
SKIP_INGRESS_FORWARD=false
FORCE_RECREATE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_step() {
    echo ""
    echo "=== $1 ==="
}

# Parse command-line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --ido-repo-path)
                IDO_REPO_PATH="$2"
                shift 2
                ;;
            --ghcr-username)
                GHCR_USERNAME="$2"
                shift 2
                ;;
            --ghcr-password)
                GHCR_PASSWORD="$2"
                shift 2
                ;;
            --ghcr-email)
                GHCR_EMAIL="$2"
                shift 2
                ;;
            --profile)
                PROFILE="$2"
                shift 2
                ;;
            --skip-ido)
                SKIP_IDO=true
                shift
                ;;
            --skip-port-forward)
                SKIP_PORT_FORWARD=true
                shift
                ;;
            --skip-ingress-forward)
                SKIP_INGRESS_FORWARD=true
                shift
                ;;
            --force-recreate)
                FORCE_RECREATE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Set up inOrch-TMF-Proxy from scratch with all required components.

OPTIONS:
    --ido-repo-path PATH       Path to IDO repository (optional, skips IDO if not provided)
    --ghcr-username USER        GitHub username for GHCR (default: arne-munch-ellingsen)
    --ghcr-password TOKEN       GitHub Personal Access Token for GHCR
    --ghcr-email EMAIL          Email for GHCR secret (default: you@example.com)
    --profile PROFILE           Minikube profile name (default: inOrch-TMF-Proxy)
    --skip-ido                  Skip IDO installation
    --skip-port-forward         Skip systemd port-forwarding setup
    --skip-ingress-forward      Skip ingress forwarding setup
    --force-recreate            Force recreation of existing minikube profile
    -h, --help                  Show this help message

ENVIRONMENT VARIABLES:
    MINIKUBE_PROFILE            Minikube profile name (overridden by --profile)
    GHCR_USERNAME               GitHub username (overridden by --ghcr-username)
    GHCR_PASSWORD               GitHub PAT (overridden by --ghcr-password or password file)
    GHCR_PASSWORD_FILE          Path to file containing GitHub PAT (default: ./github-ghrc-pat)
    GHCR_EMAIL                  Email for GHCR secret (overridden by --ghcr-email)

PASSWORD FILE:
    The script will automatically read the GitHub PAT from a file named 'github-ghrc-pat'
    in the same directory as the script. The file should contain only the token.
    Alternatively, use --ghcr-password or GHCR_PASSWORD environment variable.

EXAMPLES:
    # Full setup with IDO
    $0 --ido-repo-path ../intent-driven-orchestration --ghcr-password ghp_xxx

    # Setup without IDO
    $0 --skip-ido --ghcr-password ghp_xxx

    # Setup with environment variables
    GHCR_PASSWORD=ghp_xxx $0 --ido-repo-path ../intent-driven-orchestration
EOF
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites"
    
    local missing=()
    
    for cmd in minikube kubectl docker helm; do
        if ! command -v $cmd &> /dev/null; then
            missing+=($cmd)
        else
            log_info "$cmd is installed"
        fi
    done
    
    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing required commands: ${missing[*]}"
        echo "Please install the missing tools and try again."
        exit 1
    fi
    
    # Check if GHCR password is provided
    if [ -z "$GHCR_PASSWORD" ]; then
        log_error "GHCR password is required."
        echo ""
        echo "Provide it via one of the following methods:"
        echo "  1. Create a file: $GHCR_PASSWORD_FILE"
        echo "  2. Use --ghcr-password TOKEN command-line option"
        echo "  3. Set GHCR_PASSWORD environment variable"
        echo ""
        echo "The password file should contain only the GitHub Personal Access Token."
        exit 1
    fi
    
    log_info "All prerequisites met"
}

# Handle existing minikube profile
handle_existing_profile() {
    # Check if profile exists (minikube profile list outputs a table, so we check for the profile name in the output)
    if minikube profile list 2>/dev/null | grep -q "[[:space:]]*$PROFILE[[:space:]]"; then
        if [ "$FORCE_RECREATE" = true ]; then
            log_warn "Deleting existing minikube profile: $PROFILE"
            minikube delete -p $PROFILE
        else
            log_warn "Minikube profile '$PROFILE' already exists."
            read -p "Do you want to delete and recreate it? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                log_info "Deleting existing profile..."
                minikube delete -p $PROFILE
            else
                log_info "Using existing profile. Skipping cluster creation."
                return 1
            fi
        fi
    fi
    return 0
}

# Create and configure minikube cluster
setup_cluster() {
    log_step "Creating minikube cluster"
    
    log_info "Starting minikube with profile: $PROFILE"
    minikube start --driver=docker --cpus=16 --memory=24G -p $PROFILE
    
    log_info "Waiting for cluster to be ready..."
    kubectl wait --for=condition=ready node --all --context $PROFILE --timeout=300s
    
    # Get node name
    NODE_NAME=$(kubectl get nodes --context $PROFILE -o jsonpath='{.items[0].metadata.name}')
    log_info "Node name: $NODE_NAME"
    
    # Label node for ingress
    log_info "Labeling node for ingress..."
    kubectl label node $NODE_NAME minikube.k8s.io/primary=true --context $PROFILE --overwrite
    
    # Enable ingress addon
    log_info "Enabling ingress addon..."
    minikube addons enable ingress -p $PROFILE
    
    log_info "Waiting for ingress controller to be ready..."
    kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=controller -n ingress-nginx --context $PROFILE --timeout=300s || true
    
    # Configure ingress controller NodePort to match iptables forwarding
    configure_ingress_nodeport
    
    # Configure ingress controller externalIP for direct access
    configure_ingress_externalip
    
    # Configure chart server access from pods
    configure_chart_server_access
    
    log_info "Cluster created successfully"
}

# Configure ingress controller NodePort
configure_ingress_nodeport() {
    log_step "Configuring ingress controller NodePort"
    
    local target_port=30872
    local current_port
    
    log_info "Checking current ingress controller NodePort..."
    current_port=$(kubectl get svc ingress-nginx-controller -n ingress-nginx --context $PROFILE -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}' 2>/dev/null || echo "")
    
    if [ -z "$current_port" ]; then
        log_warn "Could not determine current NodePort, attempting to patch anyway..."
    elif [ "$current_port" = "$target_port" ]; then
        log_info "Ingress controller NodePort is already set to $target_port"
        return 0
    else
        log_info "Current NodePort is $current_port, changing to $target_port"
    fi
    
    log_info "Patching ingress controller service to use NodePort $target_port..."
    kubectl patch svc ingress-nginx-controller -n ingress-nginx --context $PROFILE \
        --type='json' \
        -p="[{\"op\": \"replace\", \"path\": \"/spec/ports/0/nodePort\", \"value\": $target_port}]" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        log_info "Successfully configured ingress controller NodePort to $target_port"
        
        # Verify the change
        sleep 2
        local verified_port
        verified_port=$(kubectl get svc ingress-nginx-controller -n ingress-nginx --context $PROFILE -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}' 2>/dev/null || echo "")
        if [ "$verified_port" = "$target_port" ]; then
            log_info "Verified: Ingress controller NodePort is now $target_port"
        else
            log_warn "Warning: Could not verify NodePort change (got: $verified_port)"
        fi
    else
        log_warn "Failed to patch ingress controller NodePort, but continuing..."
    fi
}

# Configure ingress controller externalIP and iptables forwarding
configure_ingress_externalip() {
    log_step "Configuring ingress controller externalIP and forwarding"
    
    # Get host external IP (try to detect it, or use a default)
    local host_ip
    host_ip=$(ip -o addr show | grep -E "inet.*129\.242\." | awk '{print $4}' | cut -d'/' -f1 | head -1)
    
    if [ -z "$host_ip" ]; then
        log_warn "Could not detect host external IP, skipping externalIP configuration"
        return 0
    fi
    
    log_info "Configuring ingress controller with externalIP: $host_ip"
    
    # Check if externalIP is already set
    local current_external_ip
    current_external_ip=$(kubectl get svc ingress-nginx-controller -n ingress-nginx --context $PROFILE -o jsonpath='{.spec.externalIPs[0]}' 2>/dev/null || echo "")
    
    if [ "$current_external_ip" = "$host_ip" ]; then
        log_info "Ingress controller externalIP is already set to $host_ip"
    else
        log_info "Setting ingress controller externalIP to $host_ip..."
        kubectl patch svc ingress-nginx-controller -n ingress-nginx --context $PROFILE \
            --type='json' \
            -p="[{\"op\": \"add\", \"path\": \"/spec/externalIPs\", \"value\": [\"$host_ip\"]}]" 2>/dev/null || \
        kubectl patch svc ingress-nginx-controller -n ingress-nginx --context $PROFILE \
            --type='json' \
            -p="[{\"op\": \"replace\", \"path\": \"/spec/externalIPs/0\", \"value\": \"$host_ip\"}]" 2>/dev/null
        
        if [ $? -eq 0 ]; then
            log_info "Successfully configured ingress controller externalIP to $host_ip"
        else
            log_warn "Failed to set externalIP, but continuing..."
        fi
    fi
    
    # Get minikube node IP
    local minikube_ip
    minikube_ip=$(minikube ip -p $PROFILE 2>/dev/null || echo "192.168.49.2")
    
    # Check if socat is handling port forwarding (via systemd service or direct process)
    local socat_handling_forwarding=false
    if systemctl is-active --quiet ingress-forwarding-30872.service 2>/dev/null; then
        socat_handling_forwarding=true
        log_info "Detected socat-based port forwarding (ingress-forwarding-30872.service is active)"
        log_info "Skipping DNAT rule setup to avoid conflicts with socat"
    elif pgrep -f "socat.*TCP-LISTEN:30872" >/dev/null 2>&1 && \
         (ss -tlnp 2>/dev/null | grep -q ":30872.*socat" || netstat -tlnp 2>/dev/null | grep -q ":30872.*socat"); then
        socat_handling_forwarding=true
        log_info "Detected socat process handling port forwarding on port 30872"
        log_info "Skipping DNAT rule setup to avoid conflicts with socat"
    fi
    
    # Only set up iptables DNAT rules if socat is NOT handling the forwarding
    if [ "$socat_handling_forwarding" = "false" ]; then
        log_info "Setting up iptables forwarding from $host_ip:30872 to $minikube_ip:30872"
        
        # Add DNAT rule in PREROUTING
        if ! sudo iptables -t nat -C PREROUTING -d "$host_ip" -p tcp --dport 30872 -j DNAT --to-destination "$minikube_ip:30872" 2>/dev/null; then
            sudo iptables -t nat -I PREROUTING 1 -d "$host_ip" -p tcp --dport 30872 -j DNAT --to-destination "$minikube_ip:30872"
            log_info "Added PREROUTING DNAT rule"
        else
            log_info "PREROUTING DNAT rule already exists"
        fi
        
        # Add FORWARD rule
        if ! sudo iptables -t filter -C FORWARD -d "$minikube_ip" -p tcp --dport 30872 -j ACCEPT 2>/dev/null; then
            sudo iptables -t filter -I FORWARD 1 -d "$minikube_ip" -p tcp --dport 30872 -j ACCEPT
            log_info "Added FORWARD rule"
        else
            log_info "FORWARD rule already exists"
        fi
    else
        log_info "Using socat for port forwarding - iptables DNAT rules not needed"
    fi
    
    # Enable IP forwarding if not already enabled
    SYSCTL_CMD=$(command -v sysctl || echo "/sbin/sysctl")
    if [ "$($SYSCTL_CMD -n net.ipv4.ip_forward 2>/dev/null)" != "1" ]; then
        sudo $SYSCTL_CMD -w net.ipv4.ip_forward=1
        log_info "Enabled IP forwarding"
    fi
    
    log_info "Ingress externalIP and forwarding configuration complete"
}

# Configure chart server access from pods
configure_chart_server_access() {
    log_step "Configuring chart server access from pods"
    
    # Get host external IP
    local host_ip
    host_ip=$(ip -o addr show | grep -E "inet.*129\.242\." | awk '{print $4}' | cut -d'/' -f1 | head -1)
    
    if [ -z "$host_ip" ]; then
        log_warn "Could not detect host external IP, skipping chart server service creation"
        return 0
    fi
    
    log_info "Creating Kubernetes service to expose chart server at $host_ip:3040"
    
    # Create a service that points to the host's chart server
    # This allows pods to access the chart server via a Kubernetes service
    kubectl apply --context $PROFILE -f - <<EOF 2>/dev/null || true
apiVersion: v1
kind: Service
metadata:
  name: chart-server
  namespace: default
spec:
  type: ExternalName
  externalName: ${host_ip}
  ports:
  - port: 3040
    targetPort: 3040
    protocol: TCP
    name: http
EOF

    # Alternative: Use Endpoints to point directly to host IP
    # This is more reliable than ExternalName for IP addresses
    kubectl apply --context $PROFILE -f - <<EOF 2>/dev/null || true
apiVersion: v1
kind: Endpoints
metadata:
  name: chart-server
  namespace: default
subsets:
- addresses:
  - ip: ${host_ip}
  ports:
  - port: 3040
    protocol: TCP
    name: http
EOF

    # Create the service with ClusterIP pointing to the endpoints
    kubectl apply --context $PROFILE -f - <<EOF 2>/dev/null || true
apiVersion: v1
kind: Service
metadata:
  name: chart-server
  namespace: default
spec:
  ports:
  - port: 3040
    targetPort: 3040
    protocol: TCP
    name: http
EOF

    # Add firewall rule to allow minikube network to access chart server
    log_info "Configuring firewall to allow minikube network access to chart server..."
    if ! sudo iptables -t filter -C INPUT -s 192.168.49.0/24 -p tcp --dport 3040 -j ACCEPT 2>/dev/null; then
        sudo iptables -t filter -I INPUT 1 -s 192.168.49.0/24 -p tcp --dport 3040 -j ACCEPT
        log_info "Added firewall rule to allow minikube network (192.168.49.0/24) access to port 3040"
    else
        log_info "Firewall rule already exists"
    fi
    
    log_info "Chart server service created: chart-server.default.svc.cluster.local:3040"
    log_info "Pods can now access charts via: http://chart-server.default.svc.cluster.local:3040/charts/..."
}

# Fix DNS configuration
fix_dns() {
    log_step "Checking DNS configuration"
    
    local dns_needs_fix=false
    
    # Test DNS from minikube node
    log_info "Testing DNS resolution from minikube node..."
    if minikube ssh -p $PROFILE -- "nslookup ghcr.io > /dev/null 2>&1" 2>/dev/null; then
        log_info "DNS resolution from minikube node is working"
    else
        log_warn "DNS resolution from minikube node failed"
        dns_needs_fix=true
    fi
    
    # Test DNS from within cluster (CoreDNS)
    log_info "Testing DNS resolution from cluster (CoreDNS)..."
    local test_pod="dns-test-$(date +%s)"
    local coredns_working=false
    if kubectl run $test_pod --image=busybox --rm -i --restart=Never --context $PROFILE -- nslookup ghcr.io > /dev/null 2>&1; then
        log_info "DNS resolution from cluster (CoreDNS) is working"
        coredns_working=true
    else
        log_warn "DNS resolution from cluster (CoreDNS) failed"
        # Ensure pod is cleaned up
        kubectl delete pod $test_pod --context $PROFILE --ignore-not-found=true > /dev/null 2>&1 || true
    fi
    
    if [ "$coredns_working" = false ]; then
        dns_needs_fix=true
    fi
    
    # Only apply fixes if DNS is not working
    if [ "$dns_needs_fix" = false ]; then
        log_info "DNS is working correctly, no fixes needed"
        return 0
    fi
    
    log_info "DNS needs configuration, applying fixes..."
    
    # Fix CoreDNS
    log_info "Configuring CoreDNS DNS forwarding..."
    kubectl get configmap coredns -n kube-system --context $PROFILE -o yaml | \
        sed "s|forward . /etc/resolv.conf|forward . ${DNS_SERVERS}|" | \
        kubectl apply --context $PROFILE -f -
    
    log_info "Restarting CoreDNS..."
    kubectl rollout restart deployment/coredns -n kube-system --context $PROFILE
    kubectl rollout status deployment/coredns -n kube-system --context $PROFILE --timeout=120s
    
    # Fix minikube node DNS
    log_info "Fixing DNS in minikube node..."
    minikube ssh -p $PROFILE -- "sudo bash -c '
cat > /etc/resolv.conf << EOF
nameserver 129.242.9.253
nameserver 158.38.0.1
nameserver 129.242.4.254
EOF
'"
    
    # Verify DNS after fixes
    log_info "Verifying DNS resolution after fixes..."
    sleep 5
    if minikube ssh -p $PROFILE -- "nslookup ghcr.io > /dev/null 2>&1" 2>/dev/null; then
        log_info "DNS resolution verified after fixes"
    else
        log_warn "DNS resolution test still failed after fixes, but continuing..."
    fi
}

# Install IDO
install_ido() {
    if [ "$SKIP_IDO" = true ] || [ -z "$IDO_REPO_PATH" ]; then
        if [ "$SKIP_IDO" = true ]; then
            log_info "Skipping IDO installation (--skip-ido flag set)"
        else
            log_info "Skipping IDO installation (no --ido-repo-path provided)"
        fi
        return 0
    fi
    
    log_step "Installing IDO"
    
    if [ ! -d "$IDO_REPO_PATH" ]; then
        log_error "IDO repository path does not exist: $IDO_REPO_PATH"
        exit 1
    fi
    
    local crds_file="$IDO_REPO_PATH/artefacts/intents_crds_v1alpha1.yaml"
    local manifest_file="$IDO_REPO_PATH/artefacts/deploy/manifest.yaml"
    
    if [ ! -f "$crds_file" ]; then
        log_error "IDO CRDs file not found: $crds_file"
        exit 1
    fi
    
    if [ ! -f "$manifest_file" ]; then
        log_error "IDO manifest file not found: $manifest_file"
        exit 1
    fi
    
    # Create IDO namespace
    log_info "Creating IDO namespace..."
    kubectl create namespace $IDO_NAMESPACE --context $PROFILE --dry-run=client -o yaml | kubectl apply --context $PROFILE -f -
    
    # Apply CRDs
    log_info "Applying IDO CRDs..."
    kubectl apply -f "$crds_file" --context $PROFILE
    
    # Apply manifest
    log_info "Applying IDO manifest..."
    kubectl apply -f "$manifest_file" --context $PROFILE
    
    # Create ghcr-creds secret in IDO namespace if needed
    log_info "Creating ghcr-creds secret in IDO namespace..."
    kubectl create secret docker-registry ghcr-creds \
        --docker-server=ghcr.io \
        --docker-username="$GHCR_USERNAME" \
        --docker-password="$GHCR_PASSWORD" \
        --docker-email="$GHCR_EMAIL" \
        -n $IDO_NAMESPACE \
        --context $PROFILE \
        --dry-run=client -o yaml | kubectl apply --context $PROFILE -f -
    
    log_info "Waiting for IDO components to be ready..."
    sleep 10
    
    log_info "IDO installation complete"
}

# Create GHCR credentials secret
create_ghcr_secret() {
    log_step "Creating GHCR credentials secret"
    
    # Ensure namespace exists
    kubectl create namespace $NAMESPACE --context $PROFILE --dry-run=client -o yaml | kubectl apply --context $PROFILE -f -
    
    log_info "Creating ghcr-creds secret in $NAMESPACE namespace..."
    kubectl create secret docker-registry ghcr-creds \
        --docker-server=ghcr.io \
        --docker-username="$GHCR_USERNAME" \
        --docker-password="$GHCR_PASSWORD" \
        --docker-email="$GHCR_EMAIL" \
        -n $NAMESPACE \
        --context $PROFILE \
        --dry-run=client -o yaml | kubectl apply --context $PROFILE -f -
    
    # Verify the secret was created
    if kubectl get secret ghcr-creds -n $NAMESPACE --context $PROFILE &> /dev/null; then
        log_info "GHCR credentials secret created and verified"
    else
        log_error "Failed to create GHCR credentials secret"
        return 1
    fi
}

# Build and deploy proxy
deploy_proxy() {
    log_step "Building and deploying inOrch-TMF-Proxy"
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    if [ ! -f "$SCRIPT_DIR/build-and-deploy.sh" ]; then
        log_error "build-and-deploy.sh not found in $SCRIPT_DIR"
        exit 1
    fi
    
    log_info "Running build-and-deploy.sh..."
    cd "$SCRIPT_DIR"
    
    # Run build-and-deploy.sh, but don't fail if pod verification fails
    # (the pod might exist but the verification function has issues)
    if bash ./build-and-deploy.sh; then
        log_info "Build and deploy completed successfully"
    else
        local exit_code=$?
        log_warn "Build and deploy script exited with code $exit_code"
        
        # Check if deployment actually exists and is running
        if kubectl get deployment inorch-tmf-proxy -n $NAMESPACE --context $PROFILE &> /dev/null; then
            log_info "Deployment exists, checking if it's ready..."
            if kubectl wait --for=condition=available deployment/inorch-tmf-proxy -n $NAMESPACE --context $PROFILE --timeout=60s 2>/dev/null; then
                log_info "Deployment is available, continuing despite script exit"
            else
                log_warn "Deployment exists but may not be fully ready"
            fi
        else
            log_error "Deployment not found, build-and-deploy may have failed"
            return 1
        fi
    fi
    
    log_info "Waiting for proxy deployment to be ready..."
    kubectl wait --for=condition=available deployment/inorch-tmf-proxy -n $NAMESPACE --context $PROFILE --timeout=300s || true
    
    log_info "Proxy deployment complete"
}

# Setup port forwarding (optional)
setup_port_forward() {
    if [ "$SKIP_PORT_FORWARD" = true ]; then
        log_info "Skipping port-forwarding setup (--skip-port-forward flag set)"
        return 0
    fi
    
    log_step "Setting up port-forwarding (optional)"
    
    read -p "Do you want to set up systemd port-forwarding service? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Skipping port-forwarding setup"
        return 0
    fi
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    SERVICE_FILE="$SCRIPT_DIR/systemd-portforward-inorch-tmf-proxy.service"
    
    if [ ! -f "$SERVICE_FILE" ]; then
        log_warn "Service file not found: $SERVICE_FILE"
        log_info "You can set up port-forwarding manually later"
        return 0
    fi
    
    log_info "Copying systemd service file..."
    sudo cp "$SERVICE_FILE" /etc/systemd/system/
    
    log_info "Reloading systemd daemon..."
    sudo systemctl daemon-reload
    
    log_info "Enabling and starting service..."
    sudo systemctl enable --now systemd-portforward-inorch-tmf-proxy.service
    
    log_info "Port-forwarding service is running"
    log_info "Check status with: sudo systemctl status systemd-portforward-inorch-tmf-proxy.service"
}

# Setup ingress forwarding (optional)
setup_ingress_forward() {
    if [ "$SKIP_INGRESS_FORWARD" = true ]; then
        log_info "Skipping ingress forwarding setup (--skip-ingress-forward flag set)"
        return 0
    fi
    
    log_step "Setting up ingress forwarding (optional)"
    
    read -p "Do you want to set up iptables forwarding for ingress? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Skipping ingress forwarding setup"
        return 0
    fi
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    FORWARD_SCRIPT="$SCRIPT_DIR/setup-ingress-forwarding.sh"
    
    if [ ! -f "$FORWARD_SCRIPT" ]; then
        log_warn "Ingress forwarding script not found: $FORWARD_SCRIPT"
        log_info "You can set up ingress forwarding manually later"
        return 0
    fi
    
    log_info "Running ingress forwarding setup script..."
    bash "$FORWARD_SCRIPT"
    
    log_info "Ingress forwarding setup complete"
}

# Verify setup
verify_setup() {
    log_step "Verifying setup"
    
    # Check cluster status
    log_info "Checking cluster status..."
    if minikube status -p $PROFILE &> /dev/null; then
        log_info "Cluster is running"
    else
        log_error "Cluster is not running"
        return 1
    fi
    
    # Check DNS
    log_info "Testing DNS resolution..."
    if minikube ssh -p $PROFILE -- "nslookup ghcr.io > /dev/null 2>&1" 2>/dev/null; then
        log_info "DNS resolution working"
    else
        log_warn "DNS resolution test failed"
    fi
    
    # Check ingress
    log_info "Checking ingress controller..."
    if kubectl get pods -n ingress-nginx --context $PROFILE -l app.kubernetes.io/component=controller --field-selector=status.phase=Running 2>/dev/null | grep -q controller; then
        log_info "Ingress controller is running"
    else
        log_warn "Ingress controller may not be ready"
    fi
    
    # Check proxy
    log_info "Checking inOrch-TMF-Proxy..."
    if kubectl get deployment inorch-tmf-proxy -n $NAMESPACE --context $PROFILE &> /dev/null; then
        local ready=$(kubectl get deployment inorch-tmf-proxy -n $NAMESPACE --context $PROFILE -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        local desired=$(kubectl get deployment inorch-tmf-proxy -n $NAMESPACE --context $PROFILE -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
        if [ "$ready" = "$desired" ] && [ "$ready" != "0" ]; then
            log_info "inOrch-TMF-Proxy is running ($ready/$desired replicas)"
        else
            log_warn "inOrch-TMF-Proxy may not be fully ready ($ready/$desired replicas)"
        fi
    else
        log_warn "inOrch-TMF-Proxy deployment not found"
    fi
    
    # Check IDO if installed
    if [ "$SKIP_IDO" = false ] && [ -n "$IDO_REPO_PATH" ]; then
        log_info "Checking IDO..."
        if kubectl get pods -n $IDO_NAMESPACE --context $PROFILE &> /dev/null; then
            log_info "IDO namespace exists"
        else
            log_warn "IDO namespace not found"
        fi
    fi
    
    log_info "Verification complete"
}

# Check chart server reachability
check_chart_server() {
    log_step "Checking chart server reachability"
    
    local chart_server_url="http://start5g-1.cs.uit.no:3040/"
    local timeout=5
    
    log_info "Testing connection to chart server: $chart_server_url"
    
    # Try to connect to the chart server
    if curl -s --max-time $timeout "$chart_server_url" > /dev/null 2>&1; then
        log_info "Chart server is reachable at $chart_server_url"
        return 0
    else
        log_warn "Chart server is NOT reachable at $chart_server_url"
        log_warn "Helm chart deployments will fail if the chart server is not accessible"
        log_warn "Please ensure the chart server is running before deploying workloads"
        return 1
    fi
}

# Main execution
main() {
    echo "=========================================="
    echo "  inOrch-TMF-Proxy Setup from Scratch"
    echo "=========================================="
    echo ""
    
    parse_args "$@"
    check_prerequisites
    
    local recreate_cluster=true
    handle_existing_profile || recreate_cluster=false
    
    if [ "$recreate_cluster" = true ]; then
        setup_cluster
        fix_dns
    else
        log_info "Using existing cluster, verifying configuration..."
        # Still fix DNS in case it's broken
        fix_dns
    fi
    
    install_ido
    create_ghcr_secret
    deploy_proxy
    # Recreate ghcr-creds secret after deploy_proxy (which may have deleted/recreated the namespace)
    create_ghcr_secret
    setup_port_forward
    setup_ingress_forward
    verify_setup
    check_chart_server
    
    echo ""
    echo "=========================================="
    log_info "Setup complete!"
    echo "=========================================="
    echo ""
    echo "Your inOrch-TMF-Proxy is ready to receive intents."
    echo ""
    echo "To test the proxy:"
    echo "  curl http://localhost:3020/healthz"
    echo ""
    echo "To view logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=inorch-tmf-proxy --tail=50 -f --context $PROFILE"
    echo ""
    echo "To check pod status:"
    echo "  kubectl get pods -n $NAMESPACE --context $PROFILE"
    echo ""
}

# Run main function
main "$@"

