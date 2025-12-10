#!/bin/bash
# Comprehensive setup script for inOrch-TMF-Proxy from scratch
# Sets up minikube cluster, DNS, ingress, IDO, GHCR credentials, and deploys the proxy

set -e  # Exit on error

# Default configuration
DATACENTER=""
EC_NUMBER=""
EXTERNAL_PORT=""
PROXY_NODEPORT=""
INGRESS_NODEPORT=""
PROFILE="${MINIKUBE_PROFILE:-inOrch-TMF-Proxy}"
NAMESPACE="inorch-tmf-proxy"
IDO_NAMESPACE="ido"
DNS_SERVERS="129.242.9.253 158.38.0.1 129.242.4.254"
GHCR_USERNAME="${GHCR_USERNAME:-arne-munch-ellingsen}"
MINIKUBE_CPUS="${MINIKUBE_CPUS:-16}"
MINIKUBE_MEMORY="${MINIKUBE_MEMORY:-24G}"

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
            --datacenter)
                DATACENTER="$2"
                shift 2
                ;;
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
            --cpus)
                MINIKUBE_CPUS="$2"
                shift 2
                ;;
            --memory)
                MINIKUBE_MEMORY="$2"
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
    
    # Validate that datacenter is provided (mandatory)
    if [ -z "$DATACENTER" ]; then
        log_error "Datacenter is required"
        echo ""
        echo "Please specify a datacenter using --datacenter (e.g., --datacenter EC1, --datacenter EC21)"
        echo ""
        show_help
        exit 1
    fi
    
    # Validate datacenter format (must start with EC followed by digits, case-insensitive)
    if [[ ! "$DATACENTER" =~ ^[Ee][Cc][0-9]+$ ]]; then
        log_error "Invalid datacenter format: $DATACENTER"
        echo "Datacenter must start with 'EC' followed by digits (e.g., EC1, EC21, EC41)"
        exit 1
    fi
    
    # Extract EC number (remove EC prefix, case-insensitive)
    EC_NUMBER=$(echo "$DATACENTER" | sed 's/^[Ee][Cc]//')
    
    # Calculate external port: 4000 + EC number (for port-forwarding)
    EXTERNAL_PORT=$((4000 + EC_NUMBER))
    
    # Calculate proxy NodePort: 30000 + EC number (must be in range 30000-32767)
    PROXY_NODEPORT=$((30000 + EC_NUMBER))
    
    # Set profile name to include datacenter
    PROFILE="${DATACENTER}-inOrch-TMF-Proxy"
    
    log_info "Datacenter: $DATACENTER (EC$EC_NUMBER)"
    log_info "External port: $EXTERNAL_PORT (for port-forwarding)"
    log_info "Proxy NodePort: $PROXY_NODEPORT (for Kubernetes service)"
    log_info "Profile: $PROFILE"
}

show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Set up inOrch-TMF-Proxy from scratch with all required components.

OPTIONS:
    --datacenter DC             Datacenter name (REQUIRED) (e.g., EC1, EC21, EC41)
                                Sets profile to {DC}-inOrch-TMF-Proxy and external port to 4000+EC number
    --ido-repo-path PATH        Path to IDO repository (optional, skips IDO if not provided)
    --ghcr-username USER        GitHub username for GHCR (default: arne-munch-ellingsen)
    --ghcr-password TOKEN       GitHub Personal Access Token for GHCR
    --ghcr-email EMAIL          Email for GHCR secret (default: you@example.com)
    --profile PROFILE           Minikube profile name (default: inOrch-TMF-Proxy, overridden by --datacenter)
    --cpus CPUS                 Number of CPUs to allocate to minikube (default: 16)
    --memory MEMORY             Amount of memory to allocate to minikube (default: 24G)
    --skip-ido                  Skip IDO installation
    --skip-port-forward         Skip systemd port-forwarding setup
    --skip-ingress-forward      Skip ingress forwarding setup
    --force-recreate            Force recreation of existing minikube profile
    -h, --help                  Show this help message

ENVIRONMENT VARIABLES:
    MINIKUBE_PROFILE            Minikube profile name (overridden by --profile or --datacenter)
    GHCR_USERNAME               GitHub username (overridden by --ghcr-username)
    GHCR_PASSWORD               GitHub PAT (overridden by --ghcr-password or password file)
    GHCR_PASSWORD_FILE          Path to file containing GitHub PAT (default: ./github-ghrc-pat)
    GHCR_EMAIL                  Email for GHCR secret (overridden by --ghcr-email)
    MINIKUBE_CPUS               Number of CPUs for minikube (overridden by --cpus)
    MINIKUBE_MEMORY             Memory allocation for minikube (overridden by --memory)

PASSWORD FILE:
    The script will automatically read the GitHub PAT from a file named 'github-ghrc-pat'
    in the same directory as the script. The file should contain only the token.
    Alternatively, use --ghcr-password or GHCR_PASSWORD environment variable.

EXAMPLES:
    # Full setup with IDO and datacenter EC21 (port 4021)
    $0 --datacenter EC21 --ido-repo-path ../intent-driven-orchestration --ghcr-password ghp_xxx

    # Setup with datacenter EC1 (port 4001) without IDO
    $0 --datacenter EC1 --skip-ido --ghcr-password ghp_xxx

    # Setup with environment variables and datacenter EC41 (port 4041)
    GHCR_PASSWORD=ghp_xxx $0 --datacenter EC41 --ido-repo-path ../intent-driven-orchestration

    # Setup with custom CPU and memory for datacenter EC21
    $0 --datacenter EC21 --cpus 8 --memory 16G --ghcr-password ghp_xxx
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
    
    log_info "Starting minikube with profile: $PROFILE (CPUs: $MINIKUBE_CPUS, Memory: $MINIKUBE_MEMORY)"
    minikube start --driver=docker --cpus="$MINIKUBE_CPUS" --memory="$MINIKUBE_MEMORY" -p $PROFILE
    
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
    
    # Configure ingress controller to allow snippet directives
    configure_ingress_snippets
    
    # Configure ingress controller NodePort to match iptables forwarding
    configure_ingress_nodeport
    
    # Configure ingress controller externalIP for direct access
    configure_ingress_externalip
    
    # Configure chart server access from pods
    configure_chart_server_access
    
    log_info "Cluster created successfully"
}

# Configure ingress controller to allow snippet directives
configure_ingress_snippets() {
    log_step "Configuring ingress controller to allow snippet directives"
    
    log_info "Enabling snippet annotations in ingress controller ConfigMap..."
    kubectl patch configmap ingress-nginx-controller -n ingress-nginx --context $PROFILE \
        --type merge \
        -p '{"data":{"allow-snippet-annotations":"true"}}' 2>/dev/null || \
    kubectl create configmap ingress-nginx-controller -n ingress-nginx --context $PROFILE \
        --from-literal=allow-snippet-annotations=true \
        --dry-run=client -o yaml | kubectl apply --context $PROFILE -f -
    
    if [ $? -eq 0 ]; then
        log_info "Successfully enabled snippet annotations in ingress controller"
        
        # Restart the controller to pick up the ConfigMap change
        log_info "Restarting ingress controller to apply configuration..."
        kubectl rollout restart deployment ingress-nginx-controller -n ingress-nginx --context $PROFILE
        kubectl rollout status deployment ingress-nginx-controller -n ingress-nginx --context $PROFILE --timeout=120s || true
    else
        log_warn "Failed to configure snippet annotations, but continuing..."
    fi
}

# Check if a port is in use
is_port_in_use() {
    local port=$1
    local in_use=false
    
    # Check if port is in Kubernetes NodePort range (30000-32767)
    if [ "$port" -lt 30000 ] || [ "$port" -gt 32767 ]; then
        log_warn "Port $port is outside NodePort range (30000-32767)" >&2
        return 1
    fi
    
    # Check Kubernetes services across all minikube profiles
    log_info "Checking Kubernetes services for port $port..." >&2
    local profiles
    profiles=$(minikube profile list 2>/dev/null | awk 'NR>1 {print $1}' | grep -v "^$" || true)
    
    if [ -n "$profiles" ]; then
        while IFS= read -r profile_name; do
            if [ -z "$profile_name" ]; then
                continue
            fi
            
            # Check ingress controller service in this profile
            local nodeport
            nodeport=$(kubectl get svc ingress-nginx-controller -n ingress-nginx --context "$profile_name" -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}' 2>/dev/null || echo "")
            
                    if [ "$nodeport" = "$port" ]; then
                        log_info "Port $port is already used by ingress controller in profile: $profile_name" >&2
                        in_use=true
                        break
                    fi
                done <<< "$profiles"
            fi
            
            # Check systemd services for port-forwarding services
            if [ "$in_use" = false ]; then
                log_info "Checking systemd services for port $port..." >&2
                if systemctl list-units --type=service --all 2>/dev/null | grep -q "ingress-forwarding-${port}.service"; then
                    log_info "Port $port is used by systemd service: ingress-forwarding-${port}.service" >&2
                    in_use=true
                fi
            fi
            
            # Check listening ports on host
            if [ "$in_use" = false ]; then
                log_info "Checking listening ports for port $port..." >&2
                if command -v ss >/dev/null 2>&1; then
                    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
                        log_info "Port $port is listening on host (detected via ss)" >&2
                        in_use=true
                    fi
                elif command -v netstat >/dev/null 2>&1; then
                    if netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
                        log_info "Port $port is listening on host (detected via netstat)" >&2
                        in_use=true
                    fi
                fi
            fi
            
            # Check iptables rules
            if [ "$in_use" = false ]; then
                log_info "Checking iptables rules for port $port..." >&2
                if sudo iptables -t nat -L PREROUTING -n 2>/dev/null | grep -q ":${port} "; then
                    log_info "Port $port has iptables rules configured" >&2
                    in_use=true
                fi
            fi
    
    if [ "$in_use" = true ]; then
        return 0  # Port is in use
    else
        return 1  # Port is available
    fi
}

# Find next available port starting from base port
find_available_port() {
    local base_port=$1
    local max_port=32767
    local current_port=$base_port
    
    # Send all log messages to stderr so they don't interfere with stdout (port number)
    log_info "Finding available port starting from $base_port..." >&2
    
    while [ $current_port -le $max_port ]; do
        if ! is_port_in_use $current_port 2>/dev/null; then
            log_info "Found available port: $current_port" >&2
            # Only output the port number to stdout
            printf "%d\n" $current_port
            return 0
        fi
        current_port=$((current_port + 1))
    done
    
    log_error "No available port found in range $base_port-$max_port" >&2
    return 1
}

# Configure ingress controller NodePort
configure_ingress_nodeport() {
    log_step "Configuring ingress controller NodePort"
    
    local target_port
    local current_port
    
    # Determine target port based on datacenter (datacenter is mandatory)
    # Use datacenter-based deterministic port: 32700 + EC_NUMBER
    target_port=$((32700 + EC_NUMBER))
    log_info "Using datacenter-based port: $target_port (32700 + $EC_NUMBER)"
    
    # Check if this port is available
    if is_port_in_use $target_port; then
        log_warn "Datacenter-based port $target_port is already in use, finding alternative starting from 32700..."
        target_port=$(find_available_port 32700)
        if [ $? -ne 0 ]; then
            log_error "Failed to find available port"
            return 1
        fi
    fi
    
    # Store the selected port globally
    INGRESS_NODEPORT=$target_port
    
    log_info "Selected ingress NodePort: $INGRESS_NODEPORT"
    
    # Check current port in this cluster
    log_info "Checking current ingress controller NodePort..."
    current_port=$(kubectl get svc ingress-nginx-controller -n ingress-nginx --context $PROFILE -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}' 2>/dev/null || echo "")
    
    if [ -z "$current_port" ]; then
        log_warn "Could not determine current NodePort, will set to $INGRESS_NODEPORT"
    elif [ "$current_port" = "$INGRESS_NODEPORT" ]; then
        log_info "Ingress controller NodePort is already set to $INGRESS_NODEPORT"
        return 0
    else
        log_info "Current NodePort is $current_port, changing to $INGRESS_NODEPORT"
    fi
    
    log_info "Patching ingress controller service to use NodePort $INGRESS_NODEPORT..."
    kubectl patch svc ingress-nginx-controller -n ingress-nginx --context $PROFILE \
        --type='json' \
        -p="[{\"op\": \"replace\", \"path\": \"/spec/ports/0/nodePort\", \"value\": $INGRESS_NODEPORT}]" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        log_info "Successfully configured ingress controller NodePort to $INGRESS_NODEPORT"
        
        # Verify the change
        sleep 2
        local verified_port
        verified_port=$(kubectl get svc ingress-nginx-controller -n ingress-nginx --context $PROFILE -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}' 2>/dev/null || echo "")
        if [ "$verified_port" = "$INGRESS_NODEPORT" ]; then
            log_info "Verified: Ingress controller NodePort is now $INGRESS_NODEPORT"
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
    
    # Ensure INGRESS_NODEPORT is set (should be set by configure_ingress_nodeport)
    if [ -z "$INGRESS_NODEPORT" ]; then
        log_error "INGRESS_NODEPORT is not set. This should not happen."
        return 1
    fi
    
    # Get minikube node IP
    local minikube_ip
    minikube_ip=$(minikube ip -p $PROFILE 2>/dev/null || echo "192.168.49.2")
    
    # Check if socat is handling port forwarding (via systemd service or direct process)
    local socat_handling_forwarding=false
    if systemctl is-active --quiet ingress-forwarding-${INGRESS_NODEPORT}.service 2>/dev/null; then
        socat_handling_forwarding=true
        log_info "Detected socat-based port forwarding (ingress-forwarding-${INGRESS_NODEPORT}.service is active)"
        log_info "Skipping DNAT rule setup to avoid conflicts with socat"
    elif pgrep -f "socat.*TCP-LISTEN:${INGRESS_NODEPORT}" >/dev/null 2>&1 && \
         (ss -tlnp 2>/dev/null | grep -q ":${INGRESS_NODEPORT}.*socat" || netstat -tlnp 2>/dev/null | grep -q ":${INGRESS_NODEPORT}.*socat"); then
        socat_handling_forwarding=true
        log_info "Detected socat process handling port forwarding on port ${INGRESS_NODEPORT}"
        log_info "Skipping DNAT rule setup to avoid conflicts with socat"
    fi
    
    # Only set up iptables DNAT rules if socat is NOT handling the forwarding
    if [ "$socat_handling_forwarding" = "false" ]; then
        log_info "Setting up iptables forwarding from $host_ip:${INGRESS_NODEPORT} to $minikube_ip:${INGRESS_NODEPORT}"
        
        # Add DNAT rule in PREROUTING
        if ! sudo iptables -t nat -C PREROUTING -d "$host_ip" -p tcp --dport ${INGRESS_NODEPORT} -j DNAT --to-destination "$minikube_ip:${INGRESS_NODEPORT}" 2>/dev/null; then
            sudo iptables -t nat -I PREROUTING 1 -d "$host_ip" -p tcp --dport ${INGRESS_NODEPORT} -j DNAT --to-destination "$minikube_ip:${INGRESS_NODEPORT}"
            log_info "Added PREROUTING DNAT rule"
        else
            log_info "PREROUTING DNAT rule already exists"
        fi
        
        # Add FORWARD rule
        if ! sudo iptables -t filter -C FORWARD -d "$minikube_ip" -p tcp --dport ${INGRESS_NODEPORT} -j ACCEPT 2>/dev/null; then
            sudo iptables -t filter -I FORWARD 1 -d "$minikube_ip" -p tcp --dport ${INGRESS_NODEPORT} -j ACCEPT
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
    
    # Create ghcr-secret secret in IDO namespace if needed
    log_info "Creating ghcr-secret secret in IDO namespace..."
    kubectl create secret docker-registry ghcr-secret \
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
    
    log_info "Creating ghcr-secret secret in $NAMESPACE namespace..."
    kubectl create secret docker-registry ghcr-secret \
        --docker-server=ghcr.io \
        --docker-username="$GHCR_USERNAME" \
        --docker-password="$GHCR_PASSWORD" \
        --docker-email="$GHCR_EMAIL" \
        -n $NAMESPACE \
        --context $PROFILE \
        --dry-run=client -o yaml | kubectl apply --context $PROFILE -f -
    
    # Verify the secret was created
    if kubectl get secret ghcr-secret -n $NAMESPACE --context $PROFILE &> /dev/null; then
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
    
    # Export PROFILE and PROXY_NODEPORT for build-and-deploy.sh to use
    export MINIKUBE_PROFILE="$PROFILE"
    log_info "Setting MINIKUBE_PROFILE=$PROFILE for build-and-deploy.sh"
    
    if [ -n "$PROXY_NODEPORT" ]; then
        export PROXY_NODEPORT
        log_info "Setting PROXY_NODEPORT=$PROXY_NODEPORT for build-and-deploy.sh"
    fi
    
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
    
    # If PROXY_NODEPORT is set, patch the service to use it as nodePort
    if [ -n "$PROXY_NODEPORT" ]; then
        log_info "Configuring service to use NodePort $PROXY_NODEPORT..."
        kubectl patch svc inorch-tmf-proxy -n $NAMESPACE --context $PROFILE \
            --type='json' \
            -p="[{\"op\": \"replace\", \"path\": \"/spec/type\", \"value\": \"NodePort\"}, {\"op\": \"replace\", \"path\": \"/spec/ports/0/nodePort\", \"value\": $PROXY_NODEPORT}]" 2>/dev/null || \
        kubectl patch svc inorch-tmf-proxy -n $NAMESPACE --context $PROFILE \
            --type='json' \
            -p="[{\"op\": \"add\", \"path\": \"/spec/ports/0/nodePort\", \"value\": $PROXY_NODEPORT}]" 2>/dev/null || true
        log_info "Service configured with nodePort $PROXY_NODEPORT"
    fi
    
    log_info "Waiting for proxy deployment to be ready..."
    kubectl wait --for=condition=available deployment/inorch-tmf-proxy -n $NAMESPACE --context $PROFILE --timeout=300s || true
    
    log_info "Proxy deployment complete"
}

# Deploy Prometheus to the cluster
deploy_prometheus() {
    log_step "Deploying Prometheus to Kubernetes cluster"
    
    # Check if Prometheus already exists
    if kubectl get deployment prometheus -n default --context $PROFILE &> /dev/null; then
        log_info "Prometheus deployment already exists, skipping deployment"
        return 0
    fi
    
    log_info "Creating Prometheus ServiceAccount and RBAC..."
    kubectl apply --context $PROFILE -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: prometheus
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: prometheus
rules:
  - apiGroups: [""]
    resources:
      - nodes
      - nodes/proxy
      - services
      - endpoints
      - pods
      - pods/proxy
    verbs: ["get", "list", "watch"]
  - apiGroups:
      - extensions
    resources:
      - ingresses
    verbs: ["get", "list", "watch"]
  - nonResourceURLs: ["/metrics"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: prometheus
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: prometheus
subjects:
  - kind: ServiceAccount
    name: prometheus
    namespace: default
EOF
    
    log_info "Creating Prometheus ConfigMap..."
    # Get minikube IP for API server address
    local minikube_ip
    minikube_ip=$(minikube ip -p $PROFILE 2>/dev/null || echo "192.168.49.2")
    
    kubectl apply --context $PROFILE -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: default
data:
  prometheus.yml: |
    global:
      scrape_interval: 5s

    scrape_configs:
      - job_name: 'kubernetes-pods'
        fallback_scrape_protocol: PrometheusText0.0.4
        kubernetes_sd_configs:
          - role: pod
            # Use in-cluster config (service account token will be used automatically)
        # TLS config for Kubernetes API (using in-cluster CA)
        tls_config:
          ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
          insecure_skip_verify: false
        # Bearer token for Kubernetes API authentication (required for API proxy scraping)
        bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
            action: keep
            regex: true
          # Set the API server address (use in-cluster service)
          - replacement: kubernetes.default.svc.cluster.local:443
            target_label: __address__
          # Build the metrics path using Kubernetes API proxy
          - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_pod_name, __meta_kubernetes_pod_annotation_prometheus_io_port, __meta_kubernetes_pod_annotation_prometheus_io_path]
            action: replace
            regex: (.+);(.+);(.+);(.+)
            replacement: /api/v1/namespaces/\${1}/pods/\${2}:\${3}/proxy\${4}
            target_label: __metrics_path__
          # Add scheme for HTTPS API
          - replacement: https
            target_label: __scheme__
          - action: labelmap
            regex: __meta_kubernetes_pod_label_(.+)
          - source_labels: [__meta_kubernetes_namespace]
            action: replace
            target_label: kubernetes_namespace
          - source_labels: [__meta_kubernetes_pod_name]
            action: replace
            target_label: kubernetes_pod_name
EOF
    
    log_info "Creating Prometheus Deployment..."
    kubectl apply --context $PROFILE -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prometheus
  namespace: default
  labels:
    app: prometheus
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prometheus
  template:
    metadata:
      labels:
        app: prometheus
    spec:
      serviceAccountName: prometheus
      containers:
      - name: prometheus
        image: prom/prometheus:latest
        imagePullPolicy: IfNotPresent
        args:
          - '--config.file=/etc/prometheus/prometheus.yml'
          - '--storage.tsdb.path=/prometheus'
          - '--storage.tsdb.retention.time=15d'
          - '--web.console.libraries=/usr/share/prometheus/console_libraries'
          - '--web.console.templates=/usr/share/prometheus/consoles'
          - '--web.enable-lifecycle'
        ports:
        - containerPort: 9090
          name: http
        volumeMounts:
        - name: config
          mountPath: /etc/prometheus
        - name: storage
          mountPath: /prometheus
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
      volumes:
      - name: config
        configMap:
          name: prometheus-config
      - name: storage
        emptyDir: {}
EOF
    
    log_info "Creating Prometheus Service..."
    kubectl apply --context $PROFILE -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: prometheus
  namespace: default
  labels:
    app: prometheus
spec:
  type: ClusterIP
  ports:
  - port: 9090
    targetPort: 9090
    protocol: TCP
    name: http
  selector:
    app: prometheus
EOF
    
    log_info "Waiting for Prometheus deployment to be ready..."
    kubectl wait --for=condition=available --timeout=120s deployment/prometheus -n default --context $PROFILE || {
        log_warn "Prometheus deployment may still be starting"
    }
    
    # Expose Prometheus externally via Ingress
    log_info "Creating Ingress for external Prometheus access..."
    local host_ip
    host_ip=$(ip -o addr show | grep -E "inet.*129\.242\." | awk '{print $4}' | cut -d'/' -f1 | head -1)
    
    if [ -n "$host_ip" ]; then
        kubectl apply --context $PROFILE -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: prometheus
  namespace: default
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
  - host: start5g-1.cs.uit.no
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: prometheus
            port:
              number: 9090
EOF
        log_info "Prometheus Ingress created for external access"
    else
        log_warn "Could not detect host IP, skipping Ingress creation"
    fi
    
    # Change service to NodePort and set up external access
    log_info "Configuring Prometheus service for external access..."
    local minikube_ip
    minikube_ip=$(minikube ip -p $PROFILE 2>/dev/null || echo "192.168.49.2")
    
    # Change service to NodePort (will get a port in 30000-32767 range)
    kubectl patch svc prometheus -n default --context $PROFILE --type='json' \
        -p='[{"op": "replace", "path": "/spec/type", "value": "NodePort"}]' 2>/dev/null || true
    
    # Wait a moment for the service to update
    sleep 2
    
    # Get the actual NodePort assigned (or try to set it to 30090)
    local nodeport
    nodeport=$(kubectl get svc prometheus -n default --context $PROFILE -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo "")
    
    # Try to set NodePort to 30090 (in valid range)
    if [ -z "$nodeport" ] || [ "$nodeport" != "30090" ]; then
        log_info "Setting Prometheus NodePort to 30090..."
        kubectl patch svc prometheus -n default --context $PROFILE --type='json' \
            -p="[{\"op\": \"replace\", \"path\": \"/spec/ports/0/nodePort\", \"value\": 30090}]" 2>/dev/null || true
        sleep 1
        nodeport=$(kubectl get svc prometheus -n default --context $PROFILE -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo "30090")
    fi
    
    log_info "Setting up iptables forwarding for Prometheus from port 9090 to NodePort $nodeport..."
    if [ -n "$host_ip" ] && [ -n "$nodeport" ]; then
        # Add DNAT rule: forward from host:9090 to minikube:nodeport
        if ! sudo iptables -t nat -C PREROUTING -d "$host_ip" -p tcp --dport 9090 -j DNAT --to-destination "$minikube_ip:$nodeport" 2>/dev/null; then
            sudo iptables -t nat -I PREROUTING 1 -d "$host_ip" -p tcp --dport 9090 -j DNAT --to-destination "$minikube_ip:$nodeport"
            log_info "Added PREROUTING DNAT rule for Prometheus (9090 -> $nodeport)"
        else
            log_info "PREROUTING DNAT rule for Prometheus already exists"
        fi
        
        # Add FORWARD rule
        if ! sudo iptables -t filter -C FORWARD -d "$minikube_ip" -p tcp --dport "$nodeport" -j ACCEPT 2>/dev/null; then
            sudo iptables -t filter -I FORWARD 1 -d "$minikube_ip" -p tcp --dport "$nodeport" -j ACCEPT
            log_info "Added FORWARD rule for Prometheus NodePort $nodeport"
        else
            log_info "FORWARD rule for Prometheus already exists"
        fi
        
        # Add firewall rules if ufw is active
        if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
            if ! sudo iptables -t filter -C ufw-before-input -p tcp --dport 9090 -j ACCEPT 2>/dev/null; then
                sudo iptables -t filter -I ufw-before-input 1 -p tcp --dport 9090 -j ACCEPT
                log_info "Added ufw rule for Prometheus port 9090"
            fi
        fi
        
        # Enable IP forwarding if not already enabled
        if [ "$(sysctl -n net.ipv4.ip_forward 2>/dev/null)" != "1" ]; then
            sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
            log_info "Enabled IP forwarding"
        fi
        
        log_info "Prometheus is accessible at:"
        log_info "  - In-cluster: http://prometheus.default.svc.cluster.local:9090"
        log_info "  - External: http://start5g-1.cs.uit.no:9090"
        log_info "  - External (via Ingress): http://start5g-1.cs.uit.no:${INGRESS_NODEPORT}/ (if ingress forwarding is set up)"
    else
        log_warn "Could not detect host IP or NodePort, Prometheus will only be accessible in-cluster"
        log_info "Prometheus is accessible at: http://prometheus.default.svc.cluster.local:9090"
    fi
    
    log_info "Prometheus deployment complete"
}

# Update ClusterRole with IDO permissions
update_rbac_for_ido() {
    log_step "Updating RBAC permissions for IDO custom resources"
    
    # Get the ClusterRole name (it should be the same as the fullname from Helm)
    local clusterrole_name="inorch-tmf-proxy"
    
    log_info "Checking if ClusterRole $clusterrole_name exists..."
    if ! kubectl get clusterrole $clusterrole_name --context $PROFILE &> /dev/null; then
        log_warn "ClusterRole $clusterrole_name not found, it may be created by Helm chart"
        log_info "Checking for ClusterRole with inorch-tmf-proxy prefix..."
        # Try to find the ClusterRole created by Helm
        local helm_clusterrole=$(kubectl get clusterrole --context $PROFILE -o jsonpath='{.items[?(@.metadata.labels.app\.kubernetes\.io/name=="inorch-tmf-proxy")].metadata.name}' 2>/dev/null | head -1)
        if [ -n "$helm_clusterrole" ]; then
            clusterrole_name="$helm_clusterrole"
            log_info "Found Helm ClusterRole: $clusterrole_name"
        else
            log_warn "Could not find ClusterRole, skipping RBAC update"
            log_warn "IDO permissions may need to be added manually"
            return 0
        fi
    fi
    
    log_info "Checking if IDO permissions already exist in ClusterRole $clusterrole_name..."
    if kubectl get clusterrole $clusterrole_name --context $PROFILE -o yaml | grep -q "ido.intel.com"; then
        log_info "IDO permissions already exist in ClusterRole"
        return 0
    fi
    
    log_info "Adding IDO permissions to ClusterRole $clusterrole_name..."
    
    # Patch the ClusterRole to add IDO permissions
    kubectl patch clusterrole $clusterrole_name --context $PROFILE --type='json' -p='[
        {
            "op": "add",
            "path": "/rules/-",
            "value": {
                "apiGroups": ["ido.intel.com"],
                "resources": ["kpiprofiles", "intents"],
                "verbs": ["get", "list", "watch", "create", "update", "patch", "delete"]
            }
        }
    ]' || {
        log_error "Failed to patch ClusterRole"
        log_warn "You may need to manually add IDO permissions"
        return 1
    }
    
    log_info "IDO permissions added to ClusterRole successfully"
    
    # Verify the permissions were added
    if kubectl get clusterrole $clusterrole_name --context $PROFILE -o yaml | grep -q "ido.intel.com"; then
        log_info "Verified: IDO permissions are present in ClusterRole"
    else
        log_warn "Warning: Could not verify IDO permissions were added"
    fi
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
    
    # Determine the port to use (external port is set from datacenter)
    local forward_port="$EXTERNAL_PORT"
    local service_name="systemd-portforward-inorch-tmf-proxy-${DATACENTER,,}"
    
    log_info "Setting up port forwarding from external port $forward_port to internal port 3020"
    
    # Create systemd service file dynamically
    local service_file="/tmp/${service_name}.service"
    cat > "$service_file" <<EOF
#
# Systemd unit to keep a kubectl port-forward running so the inOrch-TMF-Proxy
# service inside Minikube is reachable from remote machines.
#
[Unit]
Description=inOrch-TMF-Proxy port-forward (expose svc/inorch-tmf-proxy on port $forward_port)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=telco
WorkingDirectory=$SCRIPT_DIR
Environment=KUBECONFIG=/home/telco/.kube/config
ExecStart=/usr/local/bin/kubectl -n $NAMESPACE port-forward svc/inorch-tmf-proxy $forward_port:3020 --address 0.0.0.0 --context $PROFILE
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    
    log_info "Copying systemd service file..."
    sudo cp "$service_file" /etc/systemd/system/${service_name}.service
    rm -f "$service_file"
    
    log_info "Reloading systemd daemon..."
    sudo systemctl daemon-reload
    
    log_info "Enabling and starting service..."
    sudo systemctl enable --now ${service_name}.service
    
    log_info "Port-forwarding service is running"
    log_info "Check status with: sudo systemctl status ${service_name}.service"
    log_info "Service forwards port $forward_port (external) to port 3020 (internal)"
}

# Setup ingress forwarding (optional)
setup_ingress_forward() {
    if [ "$SKIP_INGRESS_FORWARD" = true ]; then
        log_info "Skipping ingress forwarding setup (--skip-ingress-forward flag set)"
        return 0
    fi
    
    log_step "Setting up ingress forwarding (optional)"
    
    # Ensure INGRESS_NODEPORT is set (should be set by configure_ingress_nodeport)
    if [ -z "$INGRESS_NODEPORT" ]; then
        log_error "INGRESS_NODEPORT is not set. This should not happen."
        return 1
    fi
    
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
    
    log_info "Running ingress forwarding setup script with NodePort ${INGRESS_NODEPORT}..."
    INGRESS_NODEPORT=$INGRESS_NODEPORT bash "$FORWARD_SCRIPT"
    
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
    
    # Check Prometheus
    log_info "Checking Prometheus..."
    if kubectl get deployment prometheus -n default --context $PROFILE &> /dev/null; then
        local prom_ready=$(kubectl get deployment prometheus -n default --context $PROFILE -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        local prom_desired=$(kubectl get deployment prometheus -n default --context $PROFILE -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
        if [ "$prom_ready" = "$prom_desired" ] && [ "$prom_ready" != "0" ]; then
            log_info "Prometheus is running ($prom_ready/$prom_desired replicas)"
        else
            log_warn "Prometheus may not be fully ready ($prom_ready/$prom_desired replicas)"
        fi
    else
        log_warn "Prometheus deployment not found"
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
    # Recreate ghcr-secret secret after deploy_proxy (which may have deleted/recreated the namespace)
    create_ghcr_secret
    # Update RBAC permissions for IDO custom resources
    update_rbac_for_ido
    deploy_prometheus
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
    
    # Determine the port and URL for testing (EXTERNAL_PORT is set from datacenter)
    local test_port="$EXTERNAL_PORT"
    local api_url="http://start5g-1.cs.uit.no:${EXTERNAL_PORT}/tmf-api/intentManagement/v5/"
    echo "TMF921 API endpoint:"
    echo "  $api_url"
    echo ""
    echo "To test the proxy locally (via port-forward):"
    echo "  curl http://localhost:${test_port}/healthz"
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

