#!/bin/bash
# Build and deploy inOrch-TMF-Proxy to minikube cluster (inOrch profile)

set -e  # Exit on error

PROFILE="inOrch-TMF-Proxy"
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

echo "=== Building and deploying inOrch-TMF-Proxy to minikube (profile: $PROFILE) ==="

# Check if intent-report-client exists
if [ ! -d "$INTENT_REPORT_CLIENT" ]; then
    echo "Error: intent-report-client directory not found at $INTENT_REPORT_CLIENT"
    echo "Please ensure intent-report-client is in the parent directory: $PARENT_DIR"
    exit 1
fi

# Copy intent-report-client to build directory if it doesn't exist or is a symlink
cd "$SCRIPT_DIR"
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

# Step 1: Build the image on host Docker (has working DNS)
echo ""
echo "Step 1: Building Docker image on host..."
# Unset minikube Docker environment if set
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD

# Clean Python cache to ensure fresh code is copied
echo "Cleaning Python cache files..."
find src -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
find src -name "*.pyc" -delete 2>/dev/null || true

# Build without cache to ensure code changes are included
echo "Building Docker image (without cache to ensure code changes are included)..."
docker build --no-cache -t ${IMAGE_NAME}:${IMAGE_TAG} .

# Step 2: Check and fix DNS in minikube node if needed
echo ""
echo "Step 2: Checking DNS in minikube node..."
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

# Step 3: Load image into minikube
echo ""
echo "Step 3: Loading image into minikube..."

# Get the new image creation time and size before loading (for verification)
NEW_IMAGE_CREATED=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.CreatedAt}}" | head -1)
NEW_IMAGE_SIZE=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Size}}" | head -1)
if [ -z "$NEW_IMAGE_CREATED" ]; then
    echo "✗ Error: Could not determine new image info"
    exit 1
fi

# Remove old image from minikube first to ensure fresh load
echo "Removing old image from minikube (if exists)..."
eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
# Force remove all images with this tag (there might be multiple)
docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" | xargs -r docker rmi -f 2>/dev/null || true
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD

# Load the new image
echo "Loading new image into minikube..."
if ! minikube image load ${IMAGE_NAME}:${IMAGE_TAG} -p $PROFILE; then
    echo "✗ Error: Failed to load image into minikube"
    exit 1
fi

# Wait a moment for the image to be fully loaded
sleep 2

# Verify the image was loaded (note: minikube may assign different image IDs)
echo "Verifying image was loaded into minikube..."
eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
LOADED_IMAGE_CREATED=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.CreatedAt}}" 2>/dev/null | head -1)
LOADED_IMAGE_SIZE=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Size}}" 2>/dev/null | head -1)
LOADED_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | head -1)
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD

if [ -z "$LOADED_IMAGE_CREATED" ] || [ -z "$LOADED_IMAGE_ID" ]; then
    echo "✗ Error: Image was not loaded into minikube"
    exit 1
fi

# Compare creation time and size (more reliable than ID which may differ in minikube)
# Note: minikube may assign different image IDs, so we verify by creation time and size
if [ "$NEW_IMAGE_CREATED" = "$LOADED_IMAGE_CREATED" ] || [ "$NEW_IMAGE_SIZE" = "$LOADED_IMAGE_SIZE" ]; then
    echo "✓ Image loaded successfully (ID: ${LOADED_IMAGE_ID:0:12}..., Created: $LOADED_IMAGE_CREATED)"
else
    echo "⚠ Warning: Image metadata differs (this may be normal with minikube)"
    echo "  Host image: Created=$NEW_IMAGE_CREATED, Size=$NEW_IMAGE_SIZE"
    echo "  Minikube image: Created=$LOADED_IMAGE_CREATED, Size=$LOADED_IMAGE_SIZE"
    echo "  Minikube image ID: ${LOADED_IMAGE_ID:0:12}..."
    echo "  Continuing anyway - image was loaded into minikube"
fi

# Step 4: Verify the newly built image exists
echo ""
echo "Step 4: Verifying newly built image exists..."
if docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Repository}}:{{.Tag}}" | grep -q "^${IMAGE_NAME}:${IMAGE_TAG}$"; then
    IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" | head -1)
    echo "✓ Image ${IMAGE_NAME}:${IMAGE_TAG} found (ID: ${IMAGE_ID:0:12}...)"
else
    echo "✗ Error: Image ${IMAGE_NAME}:${IMAGE_TAG} not found"
    exit 1
fi

# Step 5: Set kubectl context to inOrch
echo ""
echo "Step 5: Setting kubectl context to $PROFILE..."
kubectl config use-context $PROFILE

# Step 6: Delete namespace if it exists to ensure fresh deployment with new image
echo ""
echo "Step 6: Ensuring clean namespace for fresh deployment..."
if kubectl get namespace $NAMESPACE > /dev/null 2>&1; then
    echo "Namespace $NAMESPACE exists. Deleting to ensure fresh deployment with new image..."
    kubectl delete namespace $NAMESPACE --wait=true --timeout=60s
    echo "Waiting for namespace deletion to complete..."
    sleep 5
fi

# Create the namespace
echo "Creating namespace $NAMESPACE..."
kubectl create namespace $NAMESPACE

# Step 7: Update the Helm deployment with the new image
echo ""
echo "Step 7: Upgrading Helm deployment..."
helm upgrade ${RELEASE_NAME} charts/inorch-tmf-proxy \
  --namespace $NAMESPACE \
  --set image.repository=${IMAGE_NAME} \
  --set image.tag=${IMAGE_TAG} \
  --set image.pullPolicy=Never \
  --set env.KUBE_NAMESPACE=$NAMESPACE \
  --set env.ENABLE_K8S="true" \
  --set fullnameOverride=${FULLNAME} \
  --install  # Install if it doesn't exist

# Force rollout restart to ensure new image is used (even with same tag)
echo ""
echo "Forcing deployment restart to use new image..."
kubectl rollout restart deployment/${FULLNAME} -n $NAMESPACE

# Step 8: Wait for rollout to complete
echo ""
echo "Step 8: Waiting for deployment rollout..."
kubectl rollout status deployment/${FULLNAME} -n $NAMESPACE --timeout=300s

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
        exit 1
    fi
fi

echo "Checking pod: $POD_NAME"
# Wait a moment for pod to be fully ready
sleep 6

# Get the image being used by the pod
POD_IMAGE=$(kubectl get pod -n $NAMESPACE $POD_NAME -o jsonpath='{.spec.containers[0].image}' 2>/dev/null)
if [ -z "$POD_IMAGE" ]; then
    echo "✗ Verification failed: Could not determine pod image"
    exit 1
fi

# Verify the image exists in minikube (note: image IDs may differ, which is normal)
echo "Verifying image exists in minikube..."
eval $(minikube -p $PROFILE docker-env) > /dev/null 2>&1
MINIKUBE_IMAGE_EXISTS=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -q "^${IMAGE_NAME}:${IMAGE_TAG}$" && echo "yes" || echo "no")
MINIKUBE_IMAGE_ID=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.ID}}" 2>/dev/null | head -1)
MINIKUBE_IMAGE_CREATED=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.CreatedAt}}" 2>/dev/null | head -1)
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD

if [ "$MINIKUBE_IMAGE_EXISTS" != "yes" ] || [ -z "$MINIKUBE_IMAGE_ID" ]; then
    echo "✗ Verification failed: Image not found in minikube"
    exit 1
fi

# Verify pod is using the correct image
if [ "$POD_IMAGE" = "${IMAGE_NAME}:${IMAGE_TAG}" ]; then
    echo "✓ Verification passed: Pod is using the correct image"
    echo "  Pod image: $POD_IMAGE"
    echo "  Minikube image ID: ${MINIKUBE_IMAGE_ID:0:12}..."
    echo "  Minikube image created: $MINIKUBE_IMAGE_CREATED"
    echo "  Note: Image IDs may differ between host and minikube (this is normal)"
else
    echo "✗ Verification failed: Pod is using wrong image"
    echo "  Expected: ${IMAGE_NAME}:${IMAGE_TAG}"
    echo "  Actual: $POD_IMAGE"
    exit 1
fi

echo ""
echo "=== Build and deployment complete! ==="
echo ""
echo "To view logs, run:"
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

