#!/bin/bash
# Script to delete minikube cluster and revert all system-wide configurations
# This script brings the system back to the state before setup-cluster-from-scratch.sh was executed

set -e

# Default configuration
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

# Parse command-line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
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
}

show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Delete minikube cluster and revert all system-wide configurations.

OPTIONS:
    --profile PROFILE       Minikube profile name (default: inOrch-TMF-Proxy)
    --host-ip IP            Host external IP address (default: 129.242.22.51)
    --minikube-ip IP        Minikube node IP address (default: 192.168.49.2)
    -h, --help              Show this help message

ENVIRONMENT VARIABLES:
    MINIKUBE_PROFILE        Minikube profile name (overridden by --profile)

EXAMPLES:
    # Delete cluster with defaults
    $0

    # Delete specific profile
    $0 --profile my-profile
EOF
}

# Stop and remove systemd services
cleanup_systemd_services() {
    log_step "Cleaning up systemd services"
    
    # Stop and disable ingress forwarding service
    if systemctl list-units --type=service | grep -q "ingress-forwarding-${INGRESS_NODEPORT}.service"; then
        log_info "Stopping ingress-forwarding-${INGRESS_NODEPORT}.service..."
        sudo systemctl stop ingress-forwarding-${INGRESS_NODEPORT}.service 2>/dev/null || true
        sudo systemctl disable ingress-forwarding-${INGRESS_NODEPORT}.service 2>/dev/null || true
        log_info "Stopped and disabled ingress-forwarding-${INGRESS_NODEPORT}.service"
    else
        log_info "ingress-forwarding-${INGRESS_NODEPORT}.service not found"
    fi
    
    # Stop and disable port forwarding service
    if systemctl list-units --type=service | grep -q "systemd-portforward-inorch-tmf-proxy.service"; then
        log_info "Stopping systemd-portforward-inorch-tmf-proxy.service..."
        sudo systemctl stop systemd-portforward-inorch-tmf-proxy.service 2>/dev/null || true
        sudo systemctl disable systemd-portforward-inorch-tmf-proxy.service 2>/dev/null || true
        log_info "Stopped and disabled systemd-portforward-inorch-tmf-proxy.service"
    else
        log_info "systemd-portforward-inorch-tmf-proxy.service not found"
    fi
    
    # Kill any remaining socat processes for the ingress port
    if pgrep -f "socat.*TCP-LISTEN:${INGRESS_NODEPORT}" >/dev/null 2>&1; then
        log_info "Killing remaining socat processes for port ${INGRESS_NODEPORT}..."
        sudo pkill -f "socat.*TCP-LISTEN:${INGRESS_NODEPORT}" 2>/dev/null || true
        sleep 1
        log_info "Killed socat processes"
    fi
    
    # Remove systemd service files
    local service_files=(
        "/etc/systemd/system/ingress-forwarding-${INGRESS_NODEPORT}.service"
        "/etc/systemd/system/systemd-portforward-inorch-tmf-proxy.service"
    )
    
    for service_file in "${service_files[@]}"; do
        if [ -f "$service_file" ]; then
            log_info "Removing service file: $service_file"
            sudo rm -f "$service_file"
        fi
    done
    
    # Reload systemd daemon
    if [ -f "/etc/systemd/system/ingress-forwarding-${INGRESS_NODEPORT}.service" ] || \
       [ -f "/etc/systemd/system/systemd-portforward-inorch-tmf-proxy.service" ]; then
        log_info "Reloading systemd daemon..."
        sudo systemctl daemon-reload
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
    
    # Remove INPUT rules for minikube network to chart server (port 3040)
    log_info "Removing INPUT rules for chart server access..."
    while sudo iptables -t filter -C INPUT -s 192.168.49.0/24 -p tcp --dport 3040 -j ACCEPT 2>/dev/null; do
        sudo iptables -t filter -D INPUT -s 192.168.49.0/24 -p tcp --dport 3040 -j ACCEPT 2>/dev/null || break
        log_info "Removed INPUT rule for 192.168.49.0/24 -> port 3040"
    done
    
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
    
    log_info "iptables cleanup complete"
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

# Delete minikube cluster
delete_cluster() {
    log_step "Deleting minikube cluster"
    
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
    
    if systemctl is-active --quiet systemd-portforward-inorch-tmf-proxy.service 2>/dev/null; then
        log_error "systemd-portforward-inorch-tmf-proxy.service is still active"
        issues=$((issues + 1))
    else
        log_info "systemd-portforward-inorch-tmf-proxy.service is stopped"
    fi
    
    # Check if socat processes are still running
    if pgrep -f "socat.*TCP-LISTEN:${INGRESS_NODEPORT}" >/dev/null 2>&1; then
        log_warn "Some socat processes may still be running (check manually)"
        issues=$((issues + 1))
    else
        log_info "No socat processes found for port ${INGRESS_NODEPORT}"
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
    
    # Confirm deletion
    echo "This will:"
    echo "  - Delete minikube profile: $PROFILE"
    echo "  - Stop and remove systemd services"
    echo "  - Remove iptables rules"
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

