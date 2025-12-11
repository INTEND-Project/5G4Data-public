#!/bin/bash
# Script to delete minikube cluster and revert all system-wide configurations
# This script brings the system back to the state before setup-cluster-from-scratch.sh was executed

set -e

# Default configuration
DATACENTER=""
EC_NUMBER=""
EXTERNAL_PORT=""
PROFILE="${MINIKUBE_PROFILE:-inOrch-TMF-Proxy}"
HOST_EXTERNAL_IP="129.242.22.51"
MINIKUBE_IP="192.168.49.2"
INGRESS_NODEPORT=30872

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

# Find ufw command path (handles cases where ufw is in /usr/sbin and not in PATH)
find_ufw_cmd() {
    if command -v ufw >/dev/null 2>&1; then
        echo "ufw"
    elif [ -x "/usr/sbin/ufw" ]; then
        echo "/usr/sbin/ufw"
    elif [ -x "/sbin/ufw" ]; then
        echo "/sbin/ufw"
    else
        echo "ufw"  # Will try with sudo
    fi
}

# Check if UFW is installed
is_ufw_installed() {
    local ufw_cmd
    ufw_cmd=$(find_ufw_cmd)
    if [ "$ufw_cmd" = "ufw" ]; then
        if sudo "$ufw_cmd" --version >/dev/null 2>&1; then
            return 0
        else
            return 1
        fi
    else
        return 0
    fi
}

# Check if UFW is active
is_ufw_active() {
    if ! is_ufw_installed; then
        return 1
    fi
    local ufw_cmd
    ufw_cmd=$(find_ufw_cmd)
    if sudo "$ufw_cmd" status 2>/dev/null | grep -q "Status: active"; then
        return 0
    else
        return 1
    fi
}

# Parse command-line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --datacenter)
                DATACENTER="$2"
                shift 2
                ;;
            --profile)
                PROFILE="$2"
                shift 2
                ;;
            --host-ip)
                HOST_EXTERNAL_IP="$2"
                shift 2
                ;;
            --minikube-ip)
                MINIKUBE_IP="$2"
                shift 2
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
    
    # Calculate external port: 4000 + EC number
    EXTERNAL_PORT=$((4000 + EC_NUMBER))
    
    # Calculate ingress NodePort: 32700 + EC number (datacenter-based)
    INGRESS_NODEPORT=$((32700 + EC_NUMBER))
    
    # Calculate Helm deployment NodePort range: 30100 + (EC_NUMBER * 10) - 9 to 30100 + (EC_NUMBER * 10)
    # Each cluster gets 10 NodePorts for Helm deployments (e.g., EC21 -> 30301-30310)
    HELM_NODEPORT_START=$((30100 + EC_NUMBER * 10 - 9))
    HELM_NODEPORT_END=$((30100 + EC_NUMBER * 10))
    HELM_NODEPORT_RANGE="${HELM_NODEPORT_START}-${HELM_NODEPORT_END}"
    
    # Set profile name to include datacenter
    PROFILE="${DATACENTER}-inOrch-TMF-Proxy"
    
    # Calculate static IP for minikube: 192.168.${EC_NUMBER}.2
    # Examples: EC1 -> 192.168.1.2, EC21 -> 192.168.21.2, EC31 -> 192.168.31.2
    MINIKUBE_STATIC_IP="192.168.${EC_NUMBER}.2"
    
    log_info "Datacenter: $DATACENTER (EC$EC_NUMBER)"
    log_info "Calculated Minikube static IP: $MINIKUBE_STATIC_IP"
    log_info "External port: $EXTERNAL_PORT"
    log_info "Ingress NodePort: $INGRESS_NODEPORT"
    log_info "Helm NodePort range: $HELM_NODEPORT_RANGE"
    log_info "Profile: $PROFILE"
}

show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Delete minikube cluster and revert all system-wide configurations.

OPTIONS:
    --datacenter DC         Datacenter name (REQUIRED) (e.g., EC1, EC21, EC41)
                            Sets profile to {DC}-inOrch-TMF-Proxy and uses external port 4000+EC number
    --profile PROFILE       Minikube profile name (overridden by --datacenter)
    --host-ip IP            Host external IP address (default: 129.242.22.51)
    --minikube-ip IP        Minikube node IP address (default: 192.168.49.2)
    -h, --help              Show this help message

ENVIRONMENT VARIABLES:
    MINIKUBE_PROFILE        Minikube profile name (overridden by --profile or --datacenter)

EXAMPLES:
    # Delete cluster for datacenter EC21 (profile: EC21-inOrch-TMF-Proxy, port: 4021)
    $0 --datacenter EC21

    # Delete cluster for datacenter EC1 (profile: EC1-inOrch-TMF-Proxy, port: 4001)
    $0 --datacenter EC1
EOF
}

# Stop and remove systemd services
cleanup_systemd_services() {
    log_step "Cleaning up systemd services"
    
    # Track if any service files were removed (for systemd reload)
    local service_files_removed=false
    
    # Stop and disable ingress forwarding service
    # Check both active services and service files
    local ingress_service_file="/etc/systemd/system/ingress-forwarding-${INGRESS_NODEPORT}.service"
    if systemctl list-units --type=service --all 2>/dev/null | grep -q "ingress-forwarding-${INGRESS_NODEPORT}.service" || [ -f "$ingress_service_file" ]; then
        log_info "Stopping ingress-forwarding-${INGRESS_NODEPORT}.service..."
        sudo systemctl stop ingress-forwarding-${INGRESS_NODEPORT}.service 2>/dev/null || true
        sudo systemctl disable ingress-forwarding-${INGRESS_NODEPORT}.service 2>/dev/null || true
        log_info "Stopped and disabled ingress-forwarding-${INGRESS_NODEPORT}.service"
    else
        log_info "ingress-forwarding-${INGRESS_NODEPORT}.service not found"
    fi
    
    # Determine port forwarding service name (datacenter-specific, datacenter is mandatory)
    local portforward_service="systemd-portforward-inorch-tmf-proxy-${DATACENTER,,}"
    local portforward_service_file="/etc/systemd/system/${portforward_service}.service"
    
    # Stop and disable port forwarding service
    # Check both active services and service files
    if systemctl list-units --type=service --all 2>/dev/null | grep -q "${portforward_service}.service" || [ -f "$portforward_service_file" ]; then
        log_info "Stopping ${portforward_service}.service..."
        sudo systemctl stop ${portforward_service}.service 2>/dev/null || true
        sudo systemctl disable ${portforward_service}.service 2>/dev/null || true
        log_info "Stopped and disabled ${portforward_service}.service"
    else
        log_info "${portforward_service}.service not found"
    fi
    
    
    # Kill any remaining socat processes for the ingress port
    if pgrep -f "socat.*TCP-LISTEN:${INGRESS_NODEPORT}" >/dev/null 2>&1; then
        log_info "Killing remaining socat processes for port ${INGRESS_NODEPORT}..."
        sudo pkill -f "socat.*TCP-LISTEN:${INGRESS_NODEPORT}" 2>/dev/null || true
        sleep 1
        log_info "Killed socat processes"
    fi
    
    # Kill any remaining kubectl port-forward processes for the proxy service
    local proxy_port="${EXTERNAL_PORT:-3020}"
    if pgrep -f "kubectl.*port-forward.*inorch-tmf-proxy.*${proxy_port}" >/dev/null 2>&1; then
        log_info "Killing remaining kubectl port-forward processes for proxy port ${proxy_port}..."
        pkill -f "kubectl.*port-forward.*inorch-tmf-proxy.*${proxy_port}" 2>/dev/null || true
        sleep 1
        log_info "Killed kubectl port-forward processes"
    fi
    
    # Stop and disable NodePort forwarding services (for Helm deployments)
    if [ -n "$HELM_NODEPORT_RANGE" ]; then
        log_info "Stopping NodePort forwarding services for range $HELM_NODEPORT_RANGE..."
        local start_port end_port
        if [[ "$HELM_NODEPORT_RANGE" =~ ^([0-9]+)-([0-9]+)$ ]]; then
            start_port="${BASH_REMATCH[1]}"
            end_port="${BASH_REMATCH[2]}"
            
            for port in $(seq "$start_port" "$end_port"); do
                local service_name="nodeport-forwarding-${port}"
                local service_file="/etc/systemd/system/${service_name}.service"
                
                # Check both active services and service files
                if systemctl list-units --type=service --all 2>/dev/null | grep -q "${service_name}.service" || [ -f "$service_file" ]; then
                    log_info "Stopping ${service_name}.service..."
                    sudo systemctl stop ${service_name}.service 2>/dev/null || true
                    sudo systemctl disable ${service_name}.service 2>/dev/null || true
                    log_info "Stopped and disabled ${service_name}.service"
                fi
                
                # Kill any remaining socat processes for this port
                if pgrep -f "socat.*TCP-LISTEN:${port}," >/dev/null 2>&1; then
                    log_info "Killing remaining socat processes for port ${port}..."
                    sudo pkill -f "socat.*TCP-LISTEN:${port}," 2>/dev/null || true
                fi
                
                # Remove systemd service file (always check and remove if exists)
                if [ -f "$service_file" ]; then
                    log_info "Removing service file: $service_file"
                    sudo rm -f "$service_file"
                    service_files_removed=true
                fi
            done
        fi
    fi
    
    # Remove systemd service files (always check and remove if they exist)
    local service_files=(
        "/etc/systemd/system/ingress-forwarding-${INGRESS_NODEPORT}.service"
        "/etc/systemd/system/${portforward_service}.service"
    )
    
    for service_file in "${service_files[@]}"; do
        if [ -f "$service_file" ]; then
            log_info "Removing service file: $service_file"
            sudo rm -f "$service_file"
            service_files_removed=true
        fi
    done
    
    # Reload systemd daemon if any service files were removed
    if [ "$service_files_removed" = true ]; then
        log_info "Reloading systemd daemon..."
        sudo systemctl daemon-reload
    fi
    
    # Reset failed services to clear "not-found failed" state
    log_info "Resetting failed services..."
    local failed_services
    failed_services=$(systemctl list-units --type=service --state=failed 2>/dev/null | grep -E "(ingress-forwarding|portforward|nodeport-forwarding)" | awk '{print $1}' || true)
    
    if [ -n "$failed_services" ]; then
        while IFS= read -r service_name; do
            if [ -n "$service_name" ]; then
                log_info "Resetting failed service: $service_name"
                sudo systemctl reset-failed "$service_name" 2>/dev/null || true
            fi
        done <<< "$failed_services"
    else
        log_info "No failed services found to reset"
    fi
}

# Remove iptables rules
cleanup_iptables() {
    log_step "Cleaning up iptables rules"
    
    # Get external interface
    local external_interface
    external_interface=$(ip -o addr show | grep "$HOST_EXTERNAL_IP" | awk '{print $2}' | head -1)
    
    # Remove DNAT rules in PREROUTING
    log_info "Removing DNAT rules..."
    while sudo iptables -t nat -C PREROUTING -d "$HOST_EXTERNAL_IP" -p tcp --dport $INGRESS_NODEPORT -j DNAT --to-destination "${MINIKUBE_IP}:${INGRESS_NODEPORT}" 2>/dev/null; do
        sudo iptables -t nat -D PREROUTING -d "$HOST_EXTERNAL_IP" -p tcp --dport $INGRESS_NODEPORT -j DNAT --to-destination "${MINIKUBE_IP}:${INGRESS_NODEPORT}" 2>/dev/null || break
        log_info "Removed DNAT rule for ${HOST_EXTERNAL_IP}:${INGRESS_NODEPORT}"
    done
    
    # Remove generic DNAT rules (without specific destination IP)
    while sudo iptables -t nat -C PREROUTING -p tcp --dport $INGRESS_NODEPORT -j DNAT --to-destination "${MINIKUBE_IP}:${INGRESS_NODEPORT}" 2>/dev/null; do
        sudo iptables -t nat -D PREROUTING -p tcp --dport $INGRESS_NODEPORT -j DNAT --to-destination "${MINIKUBE_IP}:${INGRESS_NODEPORT}" 2>/dev/null || break
        log_info "Removed generic DNAT rule for port ${INGRESS_NODEPORT}"
    done
    
    # Remove FORWARD rules
    log_info "Removing FORWARD rules..."
    while sudo iptables -t filter -C FORWARD -d "$MINIKUBE_IP" -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D FORWARD -d "$MINIKUBE_IP" -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null || break
        log_info "Removed FORWARD rule for ${MINIKUBE_IP}:${INGRESS_NODEPORT}"
    done
    
    # Calculate minikube network from IP (assumes /24 subnet)
    local minikube_network
    minikube_network=$(echo "$MINIKUBE_IP" | sed 's/\.[0-9]*$/.0\/24/')
    
    log_info "Detected minikube network: $minikube_network (from IP: $MINIKUBE_IP)"
    
    # Remove INPUT rules for minikube network to chart server (port 3040)
    log_info "Removing INPUT rules for chart server access..."
    while sudo iptables -t filter -C INPUT -s "$minikube_network" -p tcp --dport 3040 -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D INPUT -s "$minikube_network" -p tcp --dport 3040 -j ACCEPT 2>/dev/null || break
        log_info "Removed INPUT rule for $minikube_network -> port 3040"
    done
    
    # Remove INPUT rules for minikube network to GraphDB (port 7200)
    log_info "Removing INPUT rules for GraphDB access..."
    while sudo iptables -t filter -C INPUT -s "$minikube_network" -p tcp --dport 7200 -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D INPUT -s "$minikube_network" -p tcp --dport 7200 -j ACCEPT 2>/dev/null || break
        log_info "Removed INPUT rule for $minikube_network -> port 7200 (GraphDB)"
    done
    
    # Remove UFW rules for GraphDB if UFW is active
    if is_ufw_installed && is_ufw_active; then
        log_info "Removing UFW rules for GraphDB access..."
        local ufw_cmd
        ufw_cmd=$(find_ufw_cmd)
        
        # Try to delete by expression first
        sudo "$ufw_cmd" delete allow from "$minikube_network" to any port 7200 2>/dev/null || true
        
        # Find and delete numbered rules that match GraphDB (network and port 7200, or GraphDB in comment)
        local rule_numbers=()
        while IFS= read -r line; do
            # Extract rule number and check if it matches GraphDB criteria
            if [[ "$line" =~ ^\[([0-9]+)\] ]]; then
                local rule_num="${BASH_REMATCH[1]}"
                # Check if rule matches network+port or contains GraphDB
                if echo "$line" | grep -qE "($minikube_network.*7200|7200.*$minikube_network|GraphDB)"; then
                    rule_numbers+=("$rule_num")
                fi
            fi
        done < <(sudo "$ufw_cmd" status numbered 2>/dev/null || true)
        
        if [ ${#rule_numbers[@]} -gt 0 ]; then
            # Sort in descending order (to avoid renumbering issues) and remove duplicates
            IFS=$'\n' unique_rules=($(printf '%s\n' "${rule_numbers[@]}" | sort -u -rn)); unset IFS
            for n in "${unique_rules[@]}"; do
                log_info "Deleting UFW rule #${n} for GraphDB access..."
                echo "y" | sudo "$ufw_cmd" delete "$n" 2>/dev/null || true
            done
            log_info "Removed UFW rules for GraphDB access from $minikube_network"
        else
            log_info "No UFW rules found for GraphDB access"
        fi
    fi
    
    # Remove DNAT and FORWARD rules for proxy external port (if datacenter is set)
    if [ -n "$EXTERNAL_PORT" ] && [ "$EXTERNAL_PORT" != "3020" ]; then
        log_info "Removing DNAT and FORWARD rules for proxy external port ${EXTERNAL_PORT}..."
        
        # Remove DNAT rules for proxy port
        while sudo iptables -t nat -C PREROUTING -d "$HOST_EXTERNAL_IP" -p tcp --dport $EXTERNAL_PORT -j DNAT --to-destination "${MINIKUBE_IP}:${EXTERNAL_PORT}" 2>/dev/null; do
            sudo iptables -t nat -D PREROUTING -d "$HOST_EXTERNAL_IP" -p tcp --dport $EXTERNAL_PORT -j DNAT --to-destination "${MINIKUBE_IP}:${EXTERNAL_PORT}" 2>/dev/null || break
            log_info "Removed DNAT rule for ${HOST_EXTERNAL_IP}:${EXTERNAL_PORT} -> ${MINIKUBE_IP}:${EXTERNAL_PORT}"
        done
        
        # Remove generic DNAT rules for proxy port
        while sudo iptables -t nat -C PREROUTING -p tcp --dport $EXTERNAL_PORT -j DNAT --to-destination "${MINIKUBE_IP}:${EXTERNAL_PORT}" 2>/dev/null; do
            sudo iptables -t nat -D PREROUTING -p tcp --dport $EXTERNAL_PORT -j DNAT --to-destination "${MINIKUBE_IP}:${EXTERNAL_PORT}" 2>/dev/null || break
            log_info "Removed generic DNAT rule for port ${EXTERNAL_PORT}"
        done
        
        # Remove FORWARD rules for proxy port
        while sudo iptables -t filter -C FORWARD -d "$MINIKUBE_IP" -p tcp --dport $EXTERNAL_PORT -j ACCEPT 2>/dev/null; do
            sudo iptables -t filter -D FORWARD -d "$MINIKUBE_IP" -p tcp --dport $EXTERNAL_PORT -j ACCEPT 2>/dev/null || break
            log_info "Removed FORWARD rule for ${MINIKUBE_IP}:${EXTERNAL_PORT}"
        done
        
        # Remove INPUT rules for proxy port
        while sudo iptables -t filter -C INPUT -p tcp --dport $EXTERNAL_PORT -j ACCEPT 2>/dev/null; do
            sudo iptables -t filter -D INPUT -p tcp --dport $EXTERNAL_PORT -j ACCEPT 2>/dev/null || break
            log_info "Removed INPUT rule for port ${EXTERNAL_PORT}"
        done
        
        # Remove UFW-specific rules for proxy port
        while sudo iptables -t filter -C ufw-before-input -p tcp --dport $EXTERNAL_PORT -j ACCEPT 2>/dev/null; do
            sudo iptables -t filter -D ufw-before-input -p tcp --dport $EXTERNAL_PORT -j ACCEPT 2>/dev/null || break
            log_info "Removed ufw-before-input rule for port ${EXTERNAL_PORT}"
        done
        
        # Remove interface-specific INPUT rules for proxy port
        if [ -n "$external_interface" ]; then
            while sudo iptables -t filter -C INPUT -i "$external_interface" -p tcp --dport $EXTERNAL_PORT -j ACCEPT 2>/dev/null; do
                sudo iptables -t filter -D INPUT -i "$external_interface" -p tcp --dport $EXTERNAL_PORT -j ACCEPT 2>/dev/null || break
                log_info "Removed INPUT rule for interface $external_interface, port ${EXTERNAL_PORT}"
            done
        fi
    fi
    
    # Remove INPUT rules for ingress port (if added directly, not via UFW)
    log_info "Removing direct INPUT rules for port ${INGRESS_NODEPORT}..."
    while sudo iptables -t filter -C INPUT -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D INPUT -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null || break
        log_info "Removed direct INPUT rule for port ${INGRESS_NODEPORT}"
    done
    
    # Remove UFW-specific rules (these are in custom chains)
    log_info "Removing UFW-specific rules..."
    
    # Remove from ufw-not-local chain
    while sudo iptables -t filter -C ufw-not-local -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D ufw-not-local -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null || break
        log_info "Removed ufw-not-local rule for port ${INGRESS_NODEPORT}"
    done
    
    # Remove from ufw-before-input chain
    while sudo iptables -t filter -C ufw-before-input -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D ufw-before-input -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null || break
        log_info "Removed ufw-before-input rule for port ${INGRESS_NODEPORT}"
    done
    
    # Remove LOG rules if they exist
    log_info "Removing LOG rules..."
    while sudo iptables -t filter -C INPUT -d "$HOST_EXTERNAL_IP" -p tcp --dport $INGRESS_NODEPORT -j LOG --log-prefix "INPUT-${INGRESS_NODEPORT}: " 2>/dev/null; do
        sudo iptables -t filter -D INPUT -d "$HOST_EXTERNAL_IP" -p tcp --dport $INGRESS_NODEPORT -j LOG --log-prefix "INPUT-${INGRESS_NODEPORT}: " 2>/dev/null || break
        log_info "Removed LOG rule for ${HOST_EXTERNAL_IP}:${INGRESS_NODEPORT}"
    done
    
    # Remove interface-specific INPUT rules
    if [ -n "$external_interface" ]; then
        while sudo iptables -t filter -C INPUT -i "$external_interface" -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null; do
            sudo iptables -t filter -D INPUT -i "$external_interface" -p tcp --dport $INGRESS_NODEPORT -j ACCEPT 2>/dev/null || break
            log_info "Removed INPUT rule for interface $external_interface, port ${INGRESS_NODEPORT}"
        done
    fi
    
    # Remove iptables rules for Helm NodePort range
    if [ -n "$HELM_NODEPORT_RANGE" ]; then
        log_info "Removing iptables rules for Helm NodePort range $HELM_NODEPORT_RANGE..."
        local start_port end_port
        if [[ "$HELM_NODEPORT_RANGE" =~ ^([0-9]+)-([0-9]+)$ ]]; then
            start_port="${BASH_REMATCH[1]}"
            end_port="${BASH_REMATCH[2]}"
            
            # Remove from ufw-before-input chain (port range)
            while sudo iptables -t filter -C ufw-before-input -p tcp --dport ${start_port}:${end_port} -j ACCEPT 2>/dev/null; do
                sudo iptables -t filter -D ufw-before-input -p tcp --dport ${start_port}:${end_port} -j ACCEPT 2>/dev/null || break
                log_info "Removed ufw-before-input rule for port range ${start_port}:${end_port}"
            done
            
            # Remove from INPUT chain (port range)
            while sudo iptables -t filter -C INPUT -p tcp --dport ${start_port}:${end_port} -j ACCEPT 2>/dev/null; do
                sudo iptables -t filter -D INPUT -p tcp --dport ${start_port}:${end_port} -j ACCEPT 2>/dev/null || break
                log_info "Removed INPUT rule for port range ${start_port}:${end_port}"
            done
        fi
    fi
    
    # Remove Prometheus iptables rules (datacenter-specific external port -> NodePort 30090)
    # Calculate datacenter-specific Prometheus external port: 19000 + EC_NUMBER
    # Last two digits represent the datacenter number
    local prometheus_external_port=$((19000 + EC_NUMBER))
    log_info "Removing Prometheus iptables rules for port $prometheus_external_port..."
    
    # Remove PREROUTING DNAT rules for Prometheus
    while sudo iptables -t nat -C PREROUTING -d "$HOST_EXTERNAL_IP" -p tcp --dport $prometheus_external_port -j DNAT --to-destination "${MINIKUBE_IP}:30090" 2>/dev/null; do
        sudo iptables -t nat -D PREROUTING -d "$HOST_EXTERNAL_IP" -p tcp --dport $prometheus_external_port -j DNAT --to-destination "${MINIKUBE_IP}:30090" 2>/dev/null || break
        log_info "Removed PREROUTING DNAT rule for Prometheus ($prometheus_external_port -> 30090)"
    done
    
    # Remove OUTPUT DNAT rules for Prometheus (for local connections)
    while sudo iptables -t nat -C OUTPUT -d "$HOST_EXTERNAL_IP" -p tcp --dport $prometheus_external_port -j DNAT --to-destination "${MINIKUBE_IP}:30090" 2>/dev/null; do
        sudo iptables -t nat -D OUTPUT -d "$HOST_EXTERNAL_IP" -p tcp --dport $prometheus_external_port -j DNAT --to-destination "${MINIKUBE_IP}:30090" 2>/dev/null || break
        log_info "Removed OUTPUT DNAT rule for Prometheus ($prometheus_external_port -> 30090)"
    done
    
    # Remove FORWARD rules for Prometheus
    while sudo iptables -t filter -C FORWARD -d "$MINIKUBE_IP" -p tcp --dport 30090 -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D FORWARD -d "$MINIKUBE_IP" -p tcp --dport 30090 -j ACCEPT 2>/dev/null || break
        log_info "Removed FORWARD rule for Prometheus (${MINIKUBE_IP}:30090)"
    done
    
    # Remove INPUT rules for Prometheus external port
    while sudo iptables -t filter -C INPUT -p tcp --dport $prometheus_external_port -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D INPUT -p tcp --dport $prometheus_external_port -j ACCEPT 2>/dev/null || break
        log_info "Removed INPUT rule for Prometheus port $prometheus_external_port"
    done
    
    # Remove ufw-before-input rules for Prometheus
    while sudo iptables -t filter -C ufw-before-input -p tcp --dport $prometheus_external_port -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D ufw-before-input -p tcp --dport $prometheus_external_port -j ACCEPT 2>/dev/null || break
        log_info "Removed ufw-before-input rule for Prometheus port $prometheus_external_port"
    done
    
    log_info "iptables cleanup complete"
}

# Remove specific UFW ports opened during setup (external port, ingress port, Prometheus)
cleanup_ufw_specific_ports() {
    log_step "Cleaning up UFW rules for specific ports"
    
    if ! is_ufw_installed || ! is_ufw_active; then
        log_info "UFW not installed/active, skipping UFW specific port cleanup"
        return 0
    fi
    
    local ufw_cmd
    ufw_cmd=$(find_ufw_cmd)
    
    # Calculate datacenter-specific Prometheus external port: 19000 + EC_NUMBER
    # Last two digits represent the datacenter number
    # Examples: EC1 -> 19001, EC21 -> 19021, EC31 -> 19031
    local prometheus_external_port=$((19000 + EC_NUMBER))
    
    # Ports to clean: external port, ingress port, prometheus datacenter-specific port
    local ports_to_clean=()
    if [ -n "$EXTERNAL_PORT" ]; then
        ports_to_clean+=("$EXTERNAL_PORT")
    fi
    if [ -n "$INGRESS_NODEPORT" ]; then
        ports_to_clean+=("$INGRESS_NODEPORT")
    fi
    ports_to_clean+=("$prometheus_external_port")
    
    for p in "${ports_to_clean[@]}"; do
        # Try delete by expression
        sudo "$ufw_cmd" delete allow ${p}/tcp 2>/dev/null || true
        
        # Delete matching numbered rules (descending to avoid renumbering issues)
        local nums
        mapfile -t nums < <(sudo "$ufw_cmd" status numbered 2>/dev/null | awk -v port="$p" '/^[[]/ {gsub(/[][]/, "", $1); if ($0 ~ port) print $1}')
        if [ ${#nums[@]} -gt 0 ]; then
            IFS=$'\n' nums=($(sort -rn <<<"${nums[*]}")); unset IFS
            for n in "${nums[@]}"; do
                log_info "Deleting UFW rule #${n} for port ${p}..."
                echo "y" | sudo "$ufw_cmd" delete "$n" 2>/dev/null || true
            done
            log_info "Removed UFW rules for port ${p}"
        else
            log_info "No UFW rules found for port ${p}"
        fi
    done
}

# Remove UFW rules for Helm NodePort range
cleanup_ufw_nodeport_rules() {
    log_step "Cleaning up UFW rules for Helm NodePort range"
    
    if [ -z "$HELM_NODEPORT_RANGE" ]; then
        log_info "Helm NodePort range not set, skipping UFW cleanup"
        return 0
    fi
    
    # Check if UFW is installed and active
    if ! is_ufw_installed; then
        log_info "UFW is not installed, skipping UFW cleanup"
        return 0
    fi
    
    if ! is_ufw_active; then
        log_info "UFW is not active, skipping UFW cleanup"
        return 0
    fi
    
    local ufw_cmd
    ufw_cmd=$(find_ufw_cmd)
    
    local start_port end_port
    if [[ "$HELM_NODEPORT_RANGE" =~ ^([0-9]+)-([0-9]+)$ ]]; then
        start_port="${BASH_REMATCH[1]}"
        end_port="${BASH_REMATCH[2]}"
        
        log_info "Removing UFW rules for port range ${start_port}:${end_port}..."
        
        # First try deleting by rule expression (all IPs)
        sudo "$ufw_cmd" delete allow ${start_port}:${end_port}/tcp 2>/dev/null || true
        
        # Then delete any numbered rules that match the range (descending to avoid renumbering issues)
        local rule_numbers
        mapfile -t rule_numbers < <(sudo "$ufw_cmd" status numbered 2>/dev/null | awk -v s="${start_port}" -v e="${end_port}" '/^[[]/ {gsub(/[][]/, "", $1); if ($0 ~ s":"e || $0 ~ s"-"e || $0 ~ s && $0 ~ e) print $1}')
        if [ ${#rule_numbers[@]} -gt 0 ]; then
            IFS=$'\n' rule_numbers=($(sort -rn <<<"${rule_numbers[*]}"))
            unset IFS
            for num in "${rule_numbers[@]}"; do
                log_info "Deleting UFW rule #${num} for NodePort range..."
                echo "y" | sudo "$ufw_cmd" delete "$num" 2>/dev/null || true
            done
            log_info "UFW rules removed for port range ${start_port}:${end_port}"
        else
            log_info "No UFW rules found for port range ${start_port}:${end_port}"
        fi
    else
        log_warn "Invalid NodePort range format: $HELM_NODEPORT_RANGE"
    fi
    
    log_info "UFW cleanup complete"
}

# Revert sysctl settings
cleanup_sysctl() {
    log_step "Reverting sysctl settings"
    
    # Get external interface
    local external_interface
    external_interface=$(ip -o addr show | grep "$HOST_EXTERNAL_IP" | awk '{print $2}' | head -1)
    
    if [ -z "$external_interface" ]; then
        log_warn "Could not detect external interface, skipping sysctl cleanup"
        return 0
    fi
    
    SYSCTL_CMD=$(command -v sysctl || echo "/sbin/sysctl")
    
    # Remove route_localnet setting from /etc/sysctl.conf
    if grep -q "net.ipv4.conf.${external_interface}.route_localnet" /etc/sysctl.conf 2>/dev/null; then
        log_info "Removing route_localnet setting from /etc/sysctl.conf..."
        sudo sed -i "/net\.ipv4\.conf\.${external_interface}\.route_localnet/d" /etc/sysctl.conf
        log_info "Removed route_localnet from /etc/sysctl.conf"
        
        # Apply the change (set to 0, which is the default)
        sudo $SYSCTL_CMD -w net.ipv4.conf.${external_interface}.route_localnet=0 2>/dev/null || true
    else
        log_info "route_localnet setting not found in /etc/sysctl.conf"
    fi
    
    # Note: We don't revert net.ipv4.ip_forward because it might be needed for other services
    # If it was enabled by this script, it will remain enabled. This is generally safe.
    log_info "sysctl cleanup complete (ip_forward left as-is for other services)"
}

# Detect ingress NodePort from cluster
detect_ingress_nodeport() {
    # INGRESS_NODEPORT should already be set from datacenter calculation
    if [ -n "$INGRESS_NODEPORT" ]; then
        log_info "Using calculated ingress NodePort: $INGRESS_NODEPORT"
        return 0
    fi
    
    # Try to detect from the cluster's ingress controller service as fallback
    if minikube profile list 2>/dev/null | grep -q "[[:space:]]*$PROFILE[[:space:]]"; then
        log_info "Detecting ingress NodePort from cluster..."
        local detected_port
        detected_port=$(kubectl get svc ingress-nginx-controller -n ingress-nginx --context $PROFILE -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}' 2>/dev/null || echo "")
        
        if [ -n "$detected_port" ]; then
            INGRESS_NODEPORT=$detected_port
            log_info "Detected ingress NodePort: $INGRESS_NODEPORT"
            return 0
        fi
    fi
    
    # This should not happen if datacenter is mandatory, but provide error message
    log_error "Could not determine ingress NodePort. This should not happen if datacenter is provided."
    return 1
}

# Delete minikube cluster
delete_cluster() {
    log_step "Deleting minikube cluster"
    
    # Detect ingress NodePort before deleting cluster
    detect_ingress_nodeport
    
    # Check if profile exists
    if ! minikube profile list 2>/dev/null | grep -q "[[:space:]]*$PROFILE[[:space:]]"; then
        log_warn "Minikube profile '$PROFILE' does not exist"
        return 0
    fi
    
    log_info "Deleting minikube profile: $PROFILE"
    if minikube delete -p $PROFILE 2>/dev/null; then
        log_info "Successfully deleted minikube profile: $PROFILE"
    else
        log_error "Failed to delete minikube profile: $PROFILE"
        return 1
    fi
}

# Verify cleanup
verify_cleanup() {
    log_step "Verifying cleanup"
    
    local issues=0
    
    # Check if cluster still exists
    if minikube profile list 2>/dev/null | grep -q "[[:space:]]*$PROFILE[[:space:]]"; then
        log_error "Cluster profile '$PROFILE' still exists"
        issues=$((issues + 1))
    else
        log_info "Cluster profile '$PROFILE' deleted"
    fi
    
    # Check if systemd services are still running
    if systemctl is-active --quiet ingress-forwarding-${INGRESS_NODEPORT}.service 2>/dev/null; then
        log_error "ingress-forwarding-${INGRESS_NODEPORT}.service is still active"
        issues=$((issues + 1))
    else
        log_info "ingress-forwarding-${INGRESS_NODEPORT}.service is stopped"
    fi
    
    # Check datacenter-specific port forwarding service (datacenter is mandatory)
    local portforward_service="systemd-portforward-inorch-tmf-proxy-${DATACENTER,,}"
    
    if systemctl is-active --quiet ${portforward_service}.service 2>/dev/null; then
        log_error "${portforward_service}.service is still active"
        issues=$((issues + 1))
    else
        log_info "${portforward_service}.service is stopped"
    fi
    
    # Check if socat processes are still running
    if pgrep -f "socat.*TCP-LISTEN:${INGRESS_NODEPORT}" >/dev/null 2>&1; then
        log_warn "Some socat processes may still be running (check manually)"
        issues=$((issues + 1))
    else
        log_info "No socat processes found for port ${INGRESS_NODEPORT}"
    fi
    
    # Check NodePort forwarding services
    if [ -n "$HELM_NODEPORT_RANGE" ]; then
        local start_port end_port
        if [[ "$HELM_NODEPORT_RANGE" =~ ^([0-9]+)-([0-9]+)$ ]]; then
            start_port="${BASH_REMATCH[1]}"
            end_port="${BASH_REMATCH[2]}"
            
            local nodeport_services_active=0
            for port in $(seq "$start_port" "$end_port"); do
                local service_name="nodeport-forwarding-${port}"
                if systemctl is-active --quiet ${service_name}.service 2>/dev/null; then
                    log_error "${service_name}.service is still active"
                    nodeport_services_active=$((nodeport_services_active + 1))
                fi
            done
            
            if [ $nodeport_services_active -eq 0 ]; then
                log_info "All NodePort forwarding services are stopped"
            else
                issues=$((issues + nodeport_services_active))
            fi
            
            # Check for remaining socat processes for NodePort range
            local nodeport_socat_found=0
            for port in $(seq "$start_port" "$end_port"); do
                if pgrep -f "socat.*TCP-LISTEN:${port}," >/dev/null 2>&1; then
                    log_warn "socat process still running for port ${port}"
                    nodeport_socat_found=$((nodeport_socat_found + 1))
                fi
            done
            
            if [ $nodeport_socat_found -eq 0 ]; then
                log_info "No socat processes found for NodePort range $HELM_NODEPORT_RANGE"
            else
                issues=$((issues + nodeport_socat_found))
            fi
        fi
    fi
    
    # Check for remaining DNAT rules
    if sudo iptables -t nat -L PREROUTING -n | grep -q "${HOST_EXTERNAL_IP}.*${INGRESS_NODEPORT}.*${MINIKUBE_IP}"; then
        log_warn "Some DNAT rules may still exist (check manually)"
        issues=$((issues + 1))
    else
        log_info "DNAT rules removed"
    fi
    
    if [ $issues -eq 0 ]; then
        log_info "Cleanup verification passed"
        return 0
    else
        log_warn "Cleanup verification found $issues issue(s)"
        return 1
    fi
}

# Main execution
main() {
    echo "=========================================="
    echo "  Delete Cluster and Revert System"
    echo "=========================================="
    echo ""
    
    parse_args "$@"
    
    # Use calculated static IP if available, otherwise try to detect from cluster
    if [ -n "$MINIKUBE_STATIC_IP" ]; then
        MINIKUBE_IP="$MINIKUBE_STATIC_IP"
        log_info "Using calculated Minikube static IP: $MINIKUBE_IP"
    elif minikube profile list 2>/dev/null | grep -q "[[:space:]]*$PROFILE[[:space:]]"; then
        # Fallback: Try to detect from cluster if it still exists
        local detected_ip
        detected_ip=$(minikube ip -p $PROFILE 2>/dev/null || echo "")
        if [ -n "$detected_ip" ]; then
            MINIKUBE_IP="$detected_ip"
            log_info "Detected minikube IP from cluster: $MINIKUBE_IP"
        fi
    fi
    
    # Detect ingress NodePort early (needed for cleanup)
    detect_ingress_nodeport
    
    # Confirm deletion
    echo "This will:"
    echo "  - Delete minikube profile: $PROFILE"
    echo "  - Stop and remove systemd services (ingress NodePort: ${INGRESS_NODEPORT})"
    echo "  - Stop and remove NodePort forwarding services (Helm NodePort range: ${HELM_NODEPORT_RANGE})"
    echo "  - Remove iptables rules"
    echo "  - Remove UFW rules for proxy/ingress/Prometheus ports and Helm NodePort range"
    echo "  - Revert sysctl settings"
    echo ""
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cancelled by user"
        exit 0
    fi
    
    # Run cleanup steps
    cleanup_systemd_services
    cleanup_iptables
    cleanup_ufw_specific_ports
    cleanup_ufw_nodeport_rules
    cleanup_sysctl
    delete_cluster
    verify_cleanup
    
    echo ""
    echo "=========================================="
    log_info "Cleanup complete!"
    echo "=========================================="
    echo ""
    echo "The system has been reverted to its state before setup-cluster-from-scratch.sh"
    echo ""
}

# Run main function
main "$@"

