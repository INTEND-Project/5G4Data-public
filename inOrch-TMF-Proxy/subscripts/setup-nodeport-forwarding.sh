#!/bin/bash
# Script to set up port forwarding for NodePort services
# This allows external access to NodePort services via the host's external IP
# Uses socat for reliable TCP proxying
# Supports single ports or ranges (e.g., 30301 or 30301-30310)

set -e

# Function to setup forwarding for a single port
setup_single_port() {
    local port="$1"
    local minikube_ip="$2"
    local host_ip="$3"
    local service_name="nodeport-forwarding-${port}"
    
    echo ""
    if [ "$DRYRUN" = true ]; then
        echo "[DRY RUN] Setting up port forwarding for port $port..."
    else
        echo "Setting up port forwarding for port $port..."
    fi
    echo "  Forwarding from $host_ip:$port to minikube node ($minikube_ip:$port)"
    
    if [ "$DRYRUN" = true ]; then
        echo "  [DRY RUN] Would stop any existing socat process for port $port"
        echo "  [DRY RUN] Would create systemd service file: /etc/systemd/system/${service_name}.service"
        echo "  [DRY RUN] Service file content:"
        echo "    [Unit]"
        echo "    Description=Port forwarding for NodePort service on port ${port}"
        echo "    After=network.target"
        echo ""
        echo "    [Service]"
        echo "    Type=simple"
        echo "    ExecStart=/usr/bin/socat TCP-LISTEN:${port},fork,reuseaddr,bind=${host_ip} TCP:${minikube_ip}:${port}"
        echo "    Restart=always"
        echo "    RestartSec=5"
        echo "    User=root"
        echo ""
        echo "    [Install]"
        echo "    WantedBy=multi-user.target"
        echo "  [DRY RUN] Would run: sudo systemctl daemon-reload"
        echo "  [DRY RUN] Would run: sudo systemctl enable ${service_name}.service"
        echo "  [DRY RUN] Would run: sudo systemctl restart ${service_name}.service"
        echo "  [DRY RUN] Would verify service is running"
        return 0
    fi
    
    # Stop any existing socat process for this port
    sudo pkill -f "socat.*:${port}," 2>/dev/null || true
    sleep 1
    
    # Create systemd service for persistent forwarding
    local service_file="/etc/systemd/system/${service_name}.service"
    
    sudo tee "$service_file" > /dev/null <<EOF
[Unit]
Description=Port forwarding for NodePort service on port ${port}
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/socat TCP-LISTEN:${port},fork,reuseaddr,bind=${host_ip} TCP:${minikube_ip}:${port}
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd and enable/start the service
    sudo systemctl daemon-reload
    sudo systemctl enable "${service_name}.service"
    sudo systemctl restart "${service_name}.service"
    
    # Wait a moment for the service to start
    sleep 1
    
    # Verify the service is running
    if sudo systemctl is-active --quiet "${service_name}.service"; then
        echo "  ✓ Service is running"
        
        # Verify socat is listening
        if sudo netstat -tlnp 2>/dev/null | grep -q ":${port}" || sudo ss -tlnp 2>/dev/null | grep -q ":${port}"; then
            echo "  ✓ Port $port is listening on $host_ip"
        else
            echo "  ⚠ Warning: Port $port may not be listening"
        fi
    else
        echo "  ✗ Error: Service failed to start"
        echo "    Check status with: sudo systemctl status ${service_name}.service"
        return 1
    fi
    
    # Add iptables rules to ensure traffic is allowed
    # Note: UFW rules are handled separately by setup_ufw_nodeport_rules() in setup-cluster-from-scratch.sh
    if [ "$DRYRUN" = true ]; then
        echo "  [DRY RUN] Would add iptables rules for port $port"
    else
        # Add iptables rules to ensure traffic is allowed
        if ! sudo iptables -t filter -C ufw-before-input -p tcp --dport $port -j ACCEPT 2>/dev/null; then
            sudo iptables -t filter -I ufw-before-input 1 -p tcp --dport $port -j ACCEPT 2>/dev/null || true
        fi
        
        if ! sudo iptables -t filter -C INPUT -p tcp --dport $port -j ACCEPT 2>/dev/null; then
            sudo iptables -t filter -I INPUT 1 -p tcp --dport $port -j ACCEPT 2>/dev/null || true
        fi
    fi
    
    return 0
}

# Accept parameters
DRYRUN=false
NODEPORT_INPUT=""
MINIKUBE_IP="${MINIKUBE_IP:-192.168.49.2}"
HOST_EXTERNAL_IP="${HOST_EXTERNAL_IP:-129.242.22.51}"
PROFILE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dryrun|--dry-run)
            DRYRUN=true
            shift
            ;;
        --minikube-ip)
            MINIKUBE_IP="$2"
            shift 2
            ;;
        --host-ip)
            HOST_EXTERNAL_IP="$2"
            shift 2
            ;;
        --profile)
            PROFILE="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 <NODEPORT_OR_RANGE> [OPTIONS]"
            echo ""
            echo "Arguments:"
            echo "  NODEPORT_OR_RANGE    Port number or range (e.g., 30301 or 30301-30310)"
            echo ""
            echo "Options:"
            echo "  --dryrun, --dry-run  Print what would be done without executing"
            echo "  --minikube-ip IP     Minikube node IP (default: 192.168.49.2)"
            echo "  --host-ip IP         Host external IP (default: 129.242.22.51)"
            echo "  --profile PROFILE    Minikube profile name"
            echo "  -h, --help           Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 30301                                    # Single port"
            echo "  $0 30301-30310                              # Range of ports"
            echo "  $0 30301 --minikube-ip 192.168.49.2 --host-ip 129.242.22.51 --profile EC21"
            echo "  $0 30301-30310 --dryrun                    # Dry run for port range"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
        *)
            if [ -z "$NODEPORT_INPUT" ]; then
                NODEPORT_INPUT="$1"
            else
                echo "Error: Multiple port specifications provided"
                echo "Use --help for usage information"
                exit 1
            fi
            shift
            ;;
    esac
done

if [ -z "$NODEPORT_INPUT" ]; then
    echo "Error: NODEPORT_OR_RANGE is required"
    echo ""
    echo "Usage: $0 <NODEPORT_OR_RANGE> [OPTIONS]"
    echo "Use --help for full usage information"
    exit 1
fi

if [ "$DRYRUN" = true ]; then
    echo "=========================================="
    echo "DRY RUN MODE - No changes will be made"
    echo "=========================================="
    echo ""
fi

# Get minikube IP from profile if provided
if [ -n "$PROFILE" ]; then
    if [ "$DRYRUN" = true ]; then
        echo "[DRY RUN] Would get minikube IP from profile $PROFILE"
        # Still try to get it for display purposes
        MINIKUBE_IP=$(minikube ip -p "$PROFILE" 2>/dev/null || echo "$MINIKUBE_IP")
    else
        MINIKUBE_IP=$(minikube ip -p "$PROFILE" 2>/dev/null || echo "$MINIKUBE_IP")
    fi
    echo "Using minikube IP from profile $PROFILE: $MINIKUBE_IP"
fi

# Check if socat is installed (skip in dry-run)
if [ "$DRYRUN" != true ]; then
    if ! command -v socat >/dev/null 2>&1; then
        echo "✗ Error: socat is not installed"
        echo "  Please install it with: sudo apt-get install socat"
        exit 1
    fi
else
    echo "[DRY RUN] Would check if socat is installed"
fi

# Parse port range or single port
if [[ "$NODEPORT_INPUT" =~ ^([0-9]+)-([0-9]+)$ ]]; then
    # It's a range
    START_PORT="${BASH_REMATCH[1]}"
    END_PORT="${BASH_REMATCH[2]}"
    
    if [ "$START_PORT" -gt "$END_PORT" ]; then
        echo "✗ Error: Start port ($START_PORT) must be less than or equal to end port ($END_PORT)"
        exit 1
    fi
    
    echo "Setting up port forwarding for NodePort range: $START_PORT-$END_PORT"
    echo "Forwarding from $HOST_EXTERNAL_IP to minikube node ($MINIKUBE_IP)"
    
    if [ "$DRYRUN" = true ]; then
        echo "[DRY RUN] Would set up forwarding for ports: $(seq -s ', ' "$START_PORT" "$END_PORT")"
    fi
    
    SUCCESSFUL_PORTS=()
    FAILED_PORTS=()
    
    for port in $(seq "$START_PORT" "$END_PORT"); do
        if setup_single_port "$port" "$MINIKUBE_IP" "$HOST_EXTERNAL_IP"; then
            SUCCESSFUL_PORTS+=("$port")
        else
            FAILED_PORTS+=("$port")
        fi
    done
    
    echo ""
    if [ "$DRYRUN" = true ]; then
        echo "=========================================="
        echo "[DRY RUN] Port forwarding setup summary:"
        echo "=========================================="
        echo "[DRY RUN] Would set up ${#SUCCESSFUL_PORTS[@]} port(s):"
        for port in "${SUCCESSFUL_PORTS[@]}"; do
            echo "  [DRY RUN] Would configure port $port"
        done
        echo ""
        echo "[DRY RUN] All ports would be accessible via:"
        echo "  http://start5g-1.cs.uit.no:<PORT>/"
        echo "  http://${HOST_EXTERNAL_IP}:<PORT>/"
    else
        echo "=========================================="
        echo "Port forwarding setup summary:"
        echo "=========================================="
        echo "Successfully set up ${#SUCCESSFUL_PORTS[@]} port(s):"
        for port in "${SUCCESSFUL_PORTS[@]}"; do
            echo "  ✓ Port $port"
        done
        
        if [ ${#FAILED_PORTS[@]} -gt 0 ]; then
            echo ""
            echo "Failed to set up ${#FAILED_PORTS[@]} port(s):"
            for port in "${FAILED_PORTS[@]}"; do
                echo "  ✗ Port $port"
            done
            exit 1
        fi
        
        echo ""
        echo "All ports are now accessible via:"
        echo "  http://start5g-1.cs.uit.no:<PORT>/"
        echo "  http://${HOST_EXTERNAL_IP}:<PORT>/"
        echo ""
        echo "Service management (for individual ports):"
        echo "  Status:  sudo systemctl status nodeport-forwarding-<PORT>.service"
        echo "  Stop:    sudo systemctl stop nodeport-forwarding-<PORT>.service"
        echo "  Start:   sudo systemctl start nodeport-forwarding-<PORT>.service"
    fi
    
else
    # Single port
    NODEPORT="$NODEPORT_INPUT"
    
    if ! [[ "$NODEPORT" =~ ^[0-9]+$ ]]; then
        echo "✗ Error: Invalid port format: $NODEPORT"
        echo "  Use a single port number (e.g., 30301) or a range (e.g., 30301-30310)"
        exit 1
    fi
    
    echo "Setting up port forwarding for NodePort service..."
    echo "Forwarding port $NODEPORT from $HOST_EXTERNAL_IP to minikube node ($MINIKUBE_IP:$NODEPORT)"

    if setup_single_port "$NODEPORT" "$MINIKUBE_IP" "$HOST_EXTERNAL_IP"; then
        if [ "$DRYRUN" = true ]; then
            echo ""
            echo "[DRY RUN] Would complete port forwarding setup for port $NODEPORT"
            echo "[DRY RUN] Service would be accessible via:"
            echo "  http://start5g-1.cs.uit.no:${NODEPORT}/"
            echo "  http://${HOST_EXTERNAL_IP}:${NODEPORT}/"
        fi
        echo ""
        echo "✓ Port forwarding setup complete!"
        echo ""
        echo "The NodePort service is now accessible via:"
        echo "  http://start5g-1.cs.uit.no:${NODEPORT}/"
        echo "  http://${HOST_EXTERNAL_IP}:${NODEPORT}/"
        echo ""
        echo "Service management:"
        echo "  Status:  sudo systemctl status nodeport-forwarding-${NODEPORT}.service"
        echo "  Stop:    sudo systemctl stop nodeport-forwarding-${NODEPORT}.service"
        echo "  Start:   sudo systemctl start nodeport-forwarding-${NODEPORT}.service"
        echo "  Restart: sudo systemctl restart nodeport-forwarding-${NODEPORT}.service"
        echo "  Remove:  sudo systemctl stop nodeport-forwarding-${NODEPORT}.service && sudo systemctl disable nodeport-forwarding-${NODEPORT}.service && sudo rm /etc/systemd/system/nodeport-forwarding-${NODEPORT}.service && sudo systemctl daemon-reload"
    else
        echo "✗ Failed to set up port forwarding for port $NODEPORT"
        exit 1
    fi
fi
