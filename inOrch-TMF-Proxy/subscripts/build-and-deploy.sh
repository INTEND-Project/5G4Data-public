#!/bin/bash
# Build and deploy inOrch-TMF-Proxy to minikube cluster

set -e  # Exit on error

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [PROFILE1] [PROFILE2] ... [OPTIONS]
       $0 --datacenter DC [OPTIONS]

Deploy inOrch-TMF-Proxy to one or more minikube cluster profiles.

Arguments:
  PROFILE1, PROFILE2, ...    Minikube profile names (comma or space separated)
                             If not provided and --datacenter not used, will prompt for input

Options:
  --datacenter DC            Datacenter name (e.g., EC1, EC21, EC31)
                             Calculates profile as {DC}-inOrch-TMF-Proxy
  --skip-build-if-exists     Skip building if image already exists, build if it doesn't
  -h, --help                 Show this help message

Examples:
  $0 EC21-inOrch-TMF-Proxy
  $0 EC21-inOrch-TMF-Proxy EC31-inOrch-TMF-Proxy
  $0 --datacenter EC21
  $0 --datacenter EC31
  $0                          # Will prompt for profiles

Environment variables:
  MINIKUBE_PROFILE           Default profile if none specified

EOF
}

# Parse command-line arguments
DATACENTER=""
PROFILE_ARGS=()
SKIP_BUILD_IF_EXISTS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --datacenter)
            DATACENTER="$2"
            shift 2
            ;;
        --skip-build-if-exists)
            SKIP_BUILD_IF_EXISTS=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            PROFILE_ARGS+=("$1")
            shift
            ;;
    esac
done

DEFAULT_PROFILE="${MINIKUBE_PROFILE:-inOrch-TMF-Proxy}"

# If datacenter is provided, calculate profile from it
if [ -n "$DATACENTER" ]; then
    # Validate datacenter format
    if [[ ! "$DATACENTER" =~ ^[Ee][Cc][0-9]+$ ]]; then
        echo "Error: Invalid datacenter format: $DATACENTER"
        echo "Datacenter must start with 'EC' followed by digits (e.g., EC1, EC21, EC31)"
        exit 1
    fi
    
    # Calculate profile from datacenter
    CALCULATED_PROFILE="${DATACENTER}-inOrch-TMF-Proxy"
    echo "Using datacenter: $DATACENTER"
    echo "Calculated profile: $CALCULATED_PROFILE"
    
    # Use calculated profile
    PROFILE_INPUT="$CALCULATED_PROFILE"
elif [ ${#PROFILE_ARGS[@]} -gt 0 ]; then
    # Use CLI arguments as profiles
    PROFILE_INPUT="${PROFILE_ARGS[*]}"
    echo "Using profiles from command line arguments: $PROFILE_INPUT"
else
    # Prompt for PROFILE name(s) - comma or space separated
    echo "Enter minikube PROFILE(s) to use (comma or space separated, default: $DEFAULT_PROFILE):"
    read -r PROFILE_INPUT
    PROFILE_INPUT="${PROFILE_INPUT:-$DEFAULT_PROFILE}"
fi

# Parse profiles: split by comma or space, trim whitespace
IFS=', ' read -ra PROFILE_ARRAY <<< "$PROFILE_INPUT"
PROFILES=()
for profile in "${PROFILE_ARRAY[@]}"; do
    # Trim whitespace
    profile=$(echo "$profile" | xargs)
    if [ -n "$profile" ]; then
        PROFILES+=("$profile")
    fi
done

# If no valid profiles, use default
if [ ${#PROFILES[@]} -eq 0 ]; then
    PROFILES=("$DEFAULT_PROFILE")
fi

echo "Will deploy to ${#PROFILES[@]} profile(s): ${PROFILES[*]}"

NAMESPACE="inorch-tmf-proxy"
IMAGE_NAME="inorch-tmf-proxy"
IMAGE_TAG="latest"
RELEASE_NAME="inorch-tmf-proxy"
FULLNAME="inorch-tmf-proxy"

get_latest_running_non_terminating_pod() {
    local namespace="$1"
    local fullname="$2"
    local pods pod_name

    # Get all running pods first, then filter out terminating ones
    pods=$(kubectl get pods -n "$namespace" -l app.kubernetes.io/name="$fullname" \
        --field-selector=status.phase=Running \
        -o json 2>/dev/null | \
        python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for item in sorted(data.get('items', []), key=lambda x: x.get('metadata', {}).get('creationTimestamp', '')):
        if item.get('metadata', {}).get('deletionTimestamp') is None:
            print(f\"{item['metadata']['creationTimestamp']}|{item['metadata']['name']}\")
except:
    pass
" 2>/dev/null || true)

    if [ -z "$pods" ]; then
        # Fallback: try simpler approach without python
        pods=$(kubectl get pods -n "$namespace" -l app.kubernetes.io/name="$fullname" \
            --field-selector=status.phase=Running \
            -o jsonpath='{range .items[*]}{.metadata.creationTimestamp}{"|"}{.metadata.name}{"\n"}{end}' \
            2>/dev/null | grep -v "^$" || true)
        
        # Filter out terminating pods manually
        if [ -n "$pods" ]; then
            local filtered_pods=""
            while IFS='|' read -r timestamp name; do
                if [ -n "$name" ]; then
                    # Check if pod has deletionTimestamp
                    if ! kubectl get pod "$name" -n "$namespace" -o jsonpath='{.metadata.deletionTimestamp}' 2>/dev/null | grep -q "."; then
                        filtered_pods="${filtered_pods}${timestamp}|${name}\n"
                    fi
                fi
            done <<< "$pods"
            pods="$filtered_pods"
        fi
    fi

    if [ -z "$pods" ]; then
        echo ""
        return
    fi

    pod_name=$(printf "%b" "$pods" | sort | tail -n1 | cut -d'|' -f2)
    printf "%s" "$pod_name"
}

# Get the script directory and parent directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
INTENT_REPORT_CLIENT="$PARENT_DIR/intent-report-client"

# Function to deploy to a single profile
deploy_to_profile() {
    local PROFILE="$1"
    local NEW_IMAGE_CREATED="$2"
    local NEW_IMAGE_SIZE="$3"
    local NEW_IMAGE_ID="$4"
    
    echo ""
    echo "=========================================="
    echo "=== Deploying to profile: $PROFILE ==="
    echo "=========================================="
    
    # Remove old image from this profile's minikube Docker
    echo "Removing old image from minikube Docker (profile: $PROFILE)..."
    eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
    docker rmi ${IMAGE_NAME}:${IMAGE_TAG} 2>/dev/null || echo "  (Image not found in minikube, continuing...)"
    unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
    
    # Step 2: Delete namespace BEFORE loading image (ensures old image is not in use)
    echo ""
    echo "Step 2: Deleting namespace to release old image references..."
    kubectl config use-context $PROFILE
    if kubectl get namespace $NAMESPACE > /dev/null 2>&1; then
        echo "Namespace $NAMESPACE exists. Deleting to release old image references..."
        kubectl delete namespace $NAMESPACE --wait=true --timeout=60s
        echo "Waiting for namespace deletion to complete..."
        sleep 5
        echo "✓ Namespace deleted - old image references released"
    else
        echo "  Namespace $NAMESPACE does not exist (nothing to delete)"
    fi
    
    # Step 3: Check and fix DNS in minikube node if needed
    echo ""
    echo "Step 3: Checking DNS in minikube node..."
    if ! minikube ssh -p $PROFILE -- "nslookup ghcr.io > /dev/null 2>&1" 2>/dev/null; then
        echo "DNS resolution failed. Fixing DNS configuration..."
        minikube ssh -p $PROFILE -- "sudo bash -c '
cat > /etc/resolv.conf << EOF
nameserver 129.242.9.253
nameserver 158.38.0.1
nameserver 129.242.4.254
EOF
'"
        echo "DNS configuration updated."
        # Verify the fix worked
        if minikube ssh -p $PROFILE -- "nslookup ghcr.io > /dev/null 2>&1" 2>/dev/null; then
            echo "✓ DNS fix verified successfully"
        else
            echo "⚠ Warning: DNS fix may not have worked. Image pulls may fail."
        fi
    else
        echo "✓ DNS is working correctly"
    fi
    
    # Step 4: Load image into minikube (after namespace deletion ensures old image is not in use)
    echo ""
    echo "Step 4: Loading image into minikube..."
    
    echo "Host image info: ID=${NEW_IMAGE_ID:0:12}..., Created=$NEW_IMAGE_CREATED, Size=$NEW_IMAGE_SIZE"
    
    # Remove old image from minikube first to ensure fresh load
    echo "Removing old image from minikube (if exists)..."
    eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
    # Get all old image IDs before removal
    OLD_MINIKUBE_IMAGE_IDS=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | sort -u || true)
    if [ -n "$OLD_MINIKUBE_IMAGE_IDS" ]; then
        echo "  Found existing image(s) in minikube:"
        echo "$OLD_MINIKUBE_IMAGE_IDS" | while read img_id; do
            if [ -n "$img_id" ]; then
                echo "    - ${img_id:0:12}..."
            fi
        done
        # Force remove all images with this tag (there might be multiple)
        echo "$OLD_MINIKUBE_IMAGE_IDS" | xargs -r docker rmi -f 2>/dev/null || true
        echo "  Removed old image(s) from minikube"
        # Wait a moment for removal to complete
        sleep 1
    fi
    unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
    
    # Load the new image
    echo "Loading new image into minikube..."
    if ! minikube image load ${IMAGE_NAME}:${IMAGE_TAG} -p $PROFILE; then
        echo "✗ Error: Failed to load image into minikube"
        return 1
    fi
    
    # Wait a moment for the image to be fully loaded and indexed
    echo "Waiting for image to be fully indexed in minikube..."
    sleep 3
    
    # Verify the old image is gone and new one is there
    eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
    CURRENT_MINIKUBE_IMAGE_IDS=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | sort -u || true)
    unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
    
    # Check if any old image IDs are still present
    if [ -n "$OLD_MINIKUBE_IMAGE_IDS" ] && [ -n "$CURRENT_MINIKUBE_IMAGE_IDS" ]; then
        for old_id in $OLD_MINIKUBE_IMAGE_IDS; do
            if echo "$CURRENT_MINIKUBE_IMAGE_IDS" | grep -q "$old_id"; then
                echo "⚠ Warning: Old image ${old_id:0:12}... is still present in minikube"
                echo "  Attempting to force remove it..."
                eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
                docker rmi -f "$old_id" 2>/dev/null || true
                unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
                sleep 1
            fi
        done
    fi
    
    # Verify the image was loaded (note: minikube may assign different image IDs)
    echo "Verifying image was loaded into minikube..."
    eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
    LOADED_IMAGE_CREATED=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.CreatedAt}}" 2>/dev/null | head -1)
    LOADED_IMAGE_SIZE=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Size}}" 2>/dev/null | head -1)
    LOADED_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | head -1)
    unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
    
    if [ -z "$LOADED_IMAGE_CREATED" ] || [ -z "$LOADED_IMAGE_ID" ]; then
        echo "✗ Error: Image was not loaded into minikube"
        return 1
    fi
    
    echo "Minikube image info: ID=${LOADED_IMAGE_ID:0:12}..., Created=$LOADED_IMAGE_CREATED, Size=$LOADED_IMAGE_SIZE"
    
    # Verify the loaded image matches the host image by comparing size and creation time
    # (Image IDs may differ between host and minikube, but size and creation time should match)
    IMAGE_MATCHES=false
    if [ "$NEW_IMAGE_SIZE" = "$LOADED_IMAGE_SIZE" ]; then
        # Size matches - this is a good indicator
        IMAGE_MATCHES=true
        echo "✓ Image size matches (${NEW_IMAGE_SIZE})"
    elif [ "$NEW_IMAGE_CREATED" = "$LOADED_IMAGE_CREATED" ]; then
        # Creation time matches - also a good indicator
        IMAGE_MATCHES=true
        echo "✓ Image creation time matches (${NEW_IMAGE_CREATED})"
    else
        echo "⚠ Warning: Image metadata differs between host and minikube"
        echo "  Host: Created=$NEW_IMAGE_CREATED, Size=$NEW_IMAGE_SIZE, ID=${NEW_IMAGE_ID:0:12}..."
        echo "  Minikube: Created=$LOADED_IMAGE_CREATED, Size=$LOADED_IMAGE_SIZE, ID=${LOADED_IMAGE_ID:0:12}..."
        echo "  This may indicate the wrong image was loaded. Checking image digest..."
        
        # Try to compare by inspecting the image layers/config
        HOST_DIGEST=$(docker inspect ${IMAGE_NAME}:${IMAGE_TAG} --format='{{index .RepoDigests 0}}' 2>/dev/null | cut -d'@' -f2 || echo "")
        if [ -n "$HOST_DIGEST" ]; then
            eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
            MINIKUBE_DIGEST=$(docker inspect ${IMAGE_NAME}:${IMAGE_TAG} --format='{{index .RepoDigests 0}}' 2>/dev/null | cut -d'@' -f2 || echo "")
            unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
            
            if [ -n "$MINIKUBE_DIGEST" ] && [ "$HOST_DIGEST" = "$MINIKUBE_DIGEST" ]; then
                IMAGE_MATCHES=true
                echo "✓ Image digest matches - images are identical"
            fi
        fi
    fi
    
    if [ "$IMAGE_MATCHES" = true ]; then
        echo "✓ Image loaded successfully and verified (Minikube ID: ${LOADED_IMAGE_ID:0:12}...)"
    else
        echo "⚠ Warning: Could not verify image match, but continuing..."
        echo "  If pods use the wrong image, you may need to manually reload:"
        echo "    minikube image load ${IMAGE_NAME}:${IMAGE_TAG} -p $PROFILE"
    fi
    
    # Step 6: Create the namespace for fresh deployment
    echo ""
    echo "Step 6: Creating namespace for fresh deployment..."
    kubectl create namespace $NAMESPACE 2>/dev/null || echo "  Namespace already exists"
    
    # Verify the new image is available in minikube before deploying
    echo "Verifying new image is available in minikube before deployment..."
    eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
    FINAL_CHECK_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | head -1)
    FINAL_CHECK_IMAGE_SIZE=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Size}}" 2>/dev/null | head -1)
    unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
    
    if [ -z "$FINAL_CHECK_IMAGE_ID" ]; then
        echo "✗ Error: New image not found in minikube. Attempting to reload..."
        minikube image load ${IMAGE_NAME}:${IMAGE_TAG} -p $PROFILE
        sleep 2
        eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
        FINAL_CHECK_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | head -1)
        unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
        if [ -z "$FINAL_CHECK_IMAGE_ID" ]; then
            echo "✗ Error: Image still not found in minikube after reload attempt"
            return 1
        fi
    fi
    
    # Verify the image matches what we built (by size)
    if [ -n "$NEW_IMAGE_SIZE" ] && [ -n "$FINAL_CHECK_IMAGE_SIZE" ] && [ "$NEW_IMAGE_SIZE" != "$FINAL_CHECK_IMAGE_SIZE" ]; then
        echo "⚠ Warning: Image size mismatch between host and minikube"
        echo "  Host size: $NEW_IMAGE_SIZE"
        echo "  Minikube size: $FINAL_CHECK_IMAGE_SIZE"
        echo "  This may indicate the wrong image is in minikube"
    fi
    
    echo "✓ Image verified in minikube (ID: ${FINAL_CHECK_IMAGE_ID:0:12}..., Size: $FINAL_CHECK_IMAGE_SIZE)"
    
    # Step 7: Update the Helm deployment with the new image
    echo ""
    echo "Step 7: Upgrading Helm deployment..."
    if [ -n "$PROXY_NODEPORT" ]; then
        echo "Setting service.nodePort to $PROXY_NODEPORT"
        helm upgrade ${RELEASE_NAME} "$PARENT_DIR/charts/inorch-tmf-proxy" \
          --namespace $NAMESPACE \
          --set image.repository=${IMAGE_NAME} \
          --set image.tag=${IMAGE_TAG} \
          --set image.pullPolicy=Never \
          --set env.KUBE_NAMESPACE=$NAMESPACE \
          --set env.ENABLE_K8S="true" \
          --set fullnameOverride=${FULLNAME} \
          --set service.type=NodePort \
          --set service.nodePort=$PROXY_NODEPORT \
          --install  # Install if it doesn't exist
    else
        helm upgrade ${RELEASE_NAME} "$PARENT_DIR/charts/inorch-tmf-proxy" \
          --namespace $NAMESPACE \
          --set image.repository=${IMAGE_NAME} \
          --set image.tag=${IMAGE_TAG} \
          --set image.pullPolicy=Never \
          --set env.KUBE_NAMESPACE=$NAMESPACE \
          --set env.ENABLE_K8S="true" \
          --set fullnameOverride=${FULLNAME} \
          --install  # Install if it doesn't exist
    fi
    
    # Force rollout restart to ensure new image is used (even with same tag)
    echo ""
    echo "Forcing deployment restart to use new image..."
    kubectl rollout restart deployment/${FULLNAME} -n $NAMESPACE
    
    # Step 8: Wait for rollout to complete
    echo ""
    echo "Step 8: Waiting for deployment rollout..."
    kubectl rollout status deployment/${FULLNAME} -n $NAMESPACE --timeout=300s
    
    # Step 8.5: Recreate GHCR secret (required for pulling images from GHCR)
    echo ""
    echo "Step 8.5: Recreating GHCR credentials secret..."
    # Get GHCR credentials
    GHCR_USERNAME="${GHCR_USERNAME:-arne-munch-ellingsen}"
    GHCR_EMAIL="${GHCR_EMAIL:-you@example.com}"
    
    # Determine password file location
    # When run as standalone script, check parent directory first
    # When run from setup-cluster-from-scratch.sh, use SCRIPT_DIR
    if [ -z "$GHCR_PASSWORD_FILE" ]; then
        # Try parent directory first (for standalone usage)
        if [ -f "$PARENT_DIR/github-ghrc-pat" ]; then
            GHCR_PASSWORD_FILE="$PARENT_DIR/github-ghrc-pat"
        # Fall back to script directory (for setup-cluster-from-scratch.sh usage)
        elif [ -f "$SCRIPT_DIR/github-ghrc-pat" ]; then
            GHCR_PASSWORD_FILE="$SCRIPT_DIR/github-ghrc-pat"
        else
            GHCR_PASSWORD_FILE="$SCRIPT_DIR/github-ghrc-pat"
        fi
    fi
    
    # Read password from file or use environment variable
    if [ -z "$GHCR_PASSWORD" ]; then
        if [ -f "$GHCR_PASSWORD_FILE" ]; then
            GHCR_PASSWORD=$(cat "$GHCR_PASSWORD_FILE" | tr -d '\n\r ')
            echo "Using GHCR password from: $GHCR_PASSWORD_FILE"
        else
            echo "⚠ Warning: GHCR password file not found at $GHCR_PASSWORD_FILE"
            echo "  Also checked: $PARENT_DIR/github-ghrc-pat"
            echo "  Skipping ghcr-secret creation. You may need to create it manually."
            GHCR_PASSWORD=""
        fi
    fi
    
    if [ -n "$GHCR_PASSWORD" ]; then
        echo "Creating ghcr-secret secret in $NAMESPACE namespace..."
        kubectl create secret docker-registry ghcr-secret \
            --docker-server=ghcr.io \
            --docker-username="$GHCR_USERNAME" \
            --docker-password="$GHCR_PASSWORD" \
            --docker-email="$GHCR_EMAIL" \
            -n $NAMESPACE \
            --dry-run=client -o yaml | kubectl apply -f -
        
        # Verify the secret was created
        if kubectl get secret ghcr-secret -n $NAMESPACE &> /dev/null; then
            echo "✓ GHCR credentials secret created and verified"
        else
            echo "⚠ Warning: Failed to verify GHCR credentials secret"
        fi
    else
        echo "⚠ Warning: GHCR password not available. Secret not created."
        echo "  To create it manually, run:"
        echo "    kubectl create secret docker-registry ghcr-secret \\"
        echo "      --docker-server=ghcr.io \\"
        echo "      --docker-username=arne-munch-ellingsen \\"
        echo "      --docker-password=\$(cat github-ghrc-pat) \\"
        echo "      --docker-email=you@example.com \\"
        echo "      -n $NAMESPACE"
    fi
    
    # Step 9: Verify the deployment
    echo ""
    echo "Step 9: Deployment status:"
    kubectl get pods -n $NAMESPACE -l app.kubernetes.io/name=${FULLNAME}
    
    # Step 10: Verify new image is running
    echo ""
    echo "Step 10: Verifying new image is running in pod..."
    # Get the newest running pod that is not terminating
    POD_NAME=$(get_latest_running_non_terminating_pod "$NAMESPACE" "$FULLNAME")
    if [ -z "$POD_NAME" ]; then
        echo "Warning: Could not find running pod to verify"
        echo "Waiting a bit longer for pod to be ready..."
        sleep 5
        POD_NAME=$(get_latest_running_non_terminating_pod "$NAMESPACE" "$FULLNAME")
        if [ -z "$POD_NAME" ]; then
            echo "✗ Error: No running pod found after waiting"
            echo "Current pods:"
            kubectl get pods -n $NAMESPACE -l app.kubernetes.io/name=${FULLNAME}
            return 1
        fi
    fi
    
    echo "Checking pod: $POD_NAME"
    # Wait a moment for pod to be fully ready
    sleep 6
    
    # Get the image being used by the pod
    POD_IMAGE=$(kubectl get pod -n $NAMESPACE $POD_NAME -o jsonpath='{.spec.containers[0].image}' 2>/dev/null)
    if [ -z "$POD_IMAGE" ]; then
        echo "✗ Verification failed: Could not determine pod image"
        return 1
    fi
    
    # Verify the image exists in minikube and get its details
    echo "Verifying image exists in minikube..."
    eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
    MINIKUBE_IMAGE_EXISTS=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -q "^${IMAGE_NAME}:${IMAGE_TAG}$" && echo "yes" || echo "no")
    MINIKUBE_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | head -1)
    MINIKUBE_IMAGE_CREATED=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.CreatedAt}}" 2>/dev/null | head -1)
    MINIKUBE_IMAGE_SIZE=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Size}}" 2>/dev/null | head -1)
    unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
    
    if [ "$MINIKUBE_IMAGE_EXISTS" != "yes" ] || [ -z "$MINIKUBE_IMAGE_ID" ]; then
        echo "✗ Verification failed: Image not found in minikube"
        echo "  Attempting to reload image..."
        minikube image load ${IMAGE_NAME}:${IMAGE_TAG} -p $PROFILE
        sleep 2
        # Re-check
        eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
        MINIKUBE_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | head -1)
        unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD
        if [ -z "$MINIKUBE_IMAGE_ID" ]; then
            echo "✗ Error: Image still not found in minikube after reload attempt"
            return 1
        fi
    fi
    
    # Get the pod's actual image ID to verify it matches
    POD_IMAGE_ID=$(kubectl get pod -n $NAMESPACE $POD_NAME -o jsonpath='{.status.containerStatuses[0].imageID}' 2>/dev/null | sed 's/.*sha256://' | cut -c1-12 || echo "")
    
    # Verify pod is using the correct image
    if [ "$POD_IMAGE" = "${IMAGE_NAME}:${IMAGE_TAG}" ]; then
        echo "✓ Pod image name matches: $POD_IMAGE"
        
        # Verify the image ID matches (or at least check if it's the expected one)
        if [ -n "$POD_IMAGE_ID" ] && [ -n "$MINIKUBE_IMAGE_ID" ]; then
            # Compare first 12 characters of image IDs
            POD_IMAGE_ID_SHORT=$(echo "$POD_IMAGE_ID" | cut -c1-12)
            MINIKUBE_IMAGE_ID_SHORT=$(echo "$MINIKUBE_IMAGE_ID" | cut -c1-12)
            
            if [ "$POD_IMAGE_ID_SHORT" = "$MINIKUBE_IMAGE_ID_SHORT" ]; then
                echo "✓ Verification passed: Pod is using the correct image ID"
                echo "  Pod image: $POD_IMAGE"
                echo "  Pod image ID: ${POD_IMAGE_ID_SHORT}..."
                echo "  Minikube image ID: ${MINIKUBE_IMAGE_ID_SHORT}..."
                echo "  Minikube image created: $MINIKUBE_IMAGE_CREATED"
                echo "  Minikube image size: $MINIKUBE_IMAGE_SIZE"
            else
                echo "⚠ Warning: Pod image ID does not match minikube image ID"
                echo "  Pod image ID: ${POD_IMAGE_ID_SHORT}..."
                echo "  Minikube image ID: ${MINIKUBE_IMAGE_ID_SHORT}..."
                echo "  This may indicate the pod is using a cached/old image"
                echo "  Attempting to force pod restart..."
                kubectl delete pod -n $NAMESPACE $POD_NAME --grace-period=0 --force 2>/dev/null || true
                echo "  Waiting for new pod to start..."
                sleep 10
                # Re-check with new pod
                NEW_POD_NAME=$(get_latest_running_non_terminating_pod "$NAMESPACE" "$FULLNAME")
                if [ -n "$NEW_POD_NAME" ]; then
                    NEW_POD_IMAGE_ID=$(kubectl get pod -n $NAMESPACE $NEW_POD_NAME -o jsonpath='{.status.containerStatuses[0].imageID}' 2>/dev/null | sed 's/.*sha256://' | cut -c1-12 || echo "")
                    if [ -n "$NEW_POD_IMAGE_ID" ] && [ "$(echo "$NEW_POD_IMAGE_ID" | cut -c1-12)" = "$MINIKUBE_IMAGE_ID_SHORT" ]; then
                        echo "✓ New pod is using the correct image"
                    else
                        echo "⚠ Warning: New pod may still be using old image. Manual intervention may be needed."
                    fi
                fi
            fi
        else
            echo "⚠ Warning: Could not verify image ID (pod may still be starting)"
            echo "  Pod image: $POD_IMAGE"
            echo "  Minikube image ID: ${MINIKUBE_IMAGE_ID:0:12}..."
            echo "  Minikube image created: $MINIKUBE_IMAGE_CREATED"
        fi
    else
        echo "✗ Verification failed: Pod is using wrong image"
        echo "  Expected: ${IMAGE_NAME}:${IMAGE_TAG}"
        echo "  Actual: $POD_IMAGE"
        return 1
    fi
    
    echo ""
    echo "=== Deployment to profile $PROFILE complete! ==="
    return 0
}

echo "=== Building and deploying inOrch-TMF-Proxy to minikube ==="

# Check if intent-report-client exists
if [ ! -d "$INTENT_REPORT_CLIENT" ]; then
    echo "Error: intent-report-client directory not found at $INTENT_REPORT_CLIENT"
    echo "Please ensure intent-report-client is in the parent directory: $PARENT_DIR"
    exit 1
fi

# Copy intent-report-client to build directory if it doesn't exist or is a symlink
cd "$PARENT_DIR"
if [ -L "intent-report-client" ] || [ ! -d "intent-report-client" ]; then
    # Remove symlink if it exists
    if [ -L "intent-report-client" ]; then
        echo "Removing existing symlink..."
        rm -f intent-report-client
    fi
    echo "Copying intent-report-client to build directory..."
    cp -r "$INTENT_REPORT_CLIENT" intent-report-client
    CLEANUP_COPY=true
else
    CLEANUP_COPY=false
fi

# Unset minikube Docker environment if set
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD

# Check if image exists when skip-build-if-exists is set
if [ "$SKIP_BUILD_IF_EXISTS" = true ]; then
    echo ""
    echo "Step 1: Checking for existing Docker image..."
    if docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Repository}}:{{.Tag}}" | grep -q "^${IMAGE_NAME}:${IMAGE_TAG}$"; then
        echo "✓ Image ${IMAGE_NAME}:${IMAGE_TAG} already exists, skipping build"
        NEW_IMAGE_CREATED=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.CreatedAt}}" | head -1)
        NEW_IMAGE_SIZE=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Size}}" | head -1)
        NEW_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" | head -1)
        echo "  Using existing image (ID: ${NEW_IMAGE_ID:0:12}..., Size: $NEW_IMAGE_SIZE, Created: $NEW_IMAGE_CREATED)"
    else
        echo "✗ Image ${IMAGE_NAME}:${IMAGE_TAG} not found, building it now..."
        SKIP_BUILD_IF_EXISTS=false  # Force build since image doesn't exist
    fi
fi

# Build image if not skipping or if image doesn't exist
if [ "$SKIP_BUILD_IF_EXISTS" = false ]; then
    # Step 0: Remove old images to force fresh build
    echo ""
    echo "Step 0: Removing old images to force fresh build..."
    # Unset minikube Docker environment if set (again)
    unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD

    # Remove old image from host Docker
    echo "Removing old image from host Docker..."
    docker rmi ${IMAGE_NAME}:${IMAGE_TAG} 2>/dev/null || echo "  (Image not found on host, continuing...)"

    # Touch source files to update timestamps (forces Docker to rebuild COPY layers)
    echo "Updating source file timestamps to force Docker rebuild..."
    touch src/inorch_tmf_proxy/services/*.py
    touch src/requirements.txt 2>/dev/null || true

    # Step 1: Build the image on host Docker (has working DNS)
    echo ""
    echo "Step 1: Building Docker image on host..."
    # Unset minikube Docker environment if set (again, in case it was set)
    unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD

    # Clean Python cache to ensure fresh code is copied
    echo "Cleaning Python cache files..."
    find src -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
    find src -name "*.pyc" -delete 2>/dev/null || true

    # Build without cache to ensure code changes are included
    echo "Building Docker image (without cache to ensure code changes are included)..."
    docker build --no-cache -t ${IMAGE_NAME}:${IMAGE_TAG} .

    # Get the new image creation time, size, and ID after building (for verification)
    echo ""
    echo "Step 1.5: Capturing image metadata..."
    NEW_IMAGE_CREATED=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.CreatedAt}}" | head -1)
    NEW_IMAGE_SIZE=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Size}}" | head -1)
    NEW_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" | head -1)
    if [ -z "$NEW_IMAGE_CREATED" ] || [ -z "$NEW_IMAGE_ID" ]; then
        echo "✗ Error: Could not determine new image info"
        exit 1
    fi

    # Verify the newly built image exists
    echo "Step 1.6: Verifying newly built image exists..."
    if docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Repository}}:{{.Tag}}" | grep -q "^${IMAGE_NAME}:${IMAGE_TAG}$"; then
        echo "✓ Image ${IMAGE_NAME}:${IMAGE_TAG} found (ID: ${NEW_IMAGE_ID:0:12}..., Size: $NEW_IMAGE_SIZE)"
    else
        echo "✗ Error: Image ${IMAGE_NAME}:${IMAGE_TAG} not found"
        exit 1
    fi
fi

# Deploy to all profiles
echo ""
echo "=========================================="
echo "=== Starting deployment to ${#PROFILES[@]} profile(s) ==="
echo "=========================================="

FAILED_PROFILES=()
SUCCESSFUL_PROFILES=()

for PROFILE in "${PROFILES[@]}"; do
    if deploy_to_profile "$PROFILE" "$NEW_IMAGE_CREATED" "$NEW_IMAGE_SIZE" "$NEW_IMAGE_ID"; then
        SUCCESSFUL_PROFILES+=("$PROFILE")
    else
        FAILED_PROFILES+=("$PROFILE")
        echo "⚠ Warning: Deployment to profile $PROFILE failed"
    fi
done

# Final summary
echo ""
echo "=========================================="
echo "=== Build and deployment summary ==="
echo "=========================================="
echo "Successfully deployed to ${#SUCCESSFUL_PROFILES[@]} profile(s):"
for profile in "${SUCCESSFUL_PROFILES[@]}"; do
    echo "  ✓ $profile"
done

if [ ${#FAILED_PROFILES[@]} -gt 0 ]; then
    echo ""
    echo "Failed to deploy to ${#FAILED_PROFILES[@]} profile(s):"
    for profile in "${FAILED_PROFILES[@]}"; do
        echo "  ✗ $profile"
    done
    echo ""
    exit 1
fi

echo ""
echo "=== Build and deployment complete! ==="
echo ""
echo "To view logs for a profile, run:"
echo "  kubectl config use-context <PROFILE>"
echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=${FULLNAME} --tail=50 -f"
echo ""
echo "To check pod status:"
echo "  kubectl get pods -n $NAMESPACE"
echo ""
echo "To check deployment:"
echo "  kubectl get deployment -n $NAMESPACE"

# Cleanup copied directory if we created it
if [ "$CLEANUP_COPY" = true ]; then
    echo ""
    echo "Cleaning up copied intent-report-client..."
    rm -rf intent-report-client
fi
