#!/bin/bash
# Build and push script for Rusty LLM application and modified Open WebUI to GHCR and ChartMuseum

set -e

# Configuration
GITHUB_USERNAME="${GITHUB_USERNAME:-arne-munch-ellingsen}"
RUSTY_LLM_IMAGE_NAME="rusty_llm"
OPEN_WEBUI_IMAGE_NAME="open-webui"
RUSTY_LLM_VERSION="${1:-latest}"
OPEN_WEBUI_VERSION="${OPEN_WEBUI_VERSION:-rusty-llm-subpath}"
RUSTY_LLM_REPO="ghcr.io/${GITHUB_USERNAME}/${RUSTY_LLM_IMAGE_NAME}"
OPEN_WEBUI_REPO="ghcr.io/${GITHUB_USERNAME}/${OPEN_WEBUI_IMAGE_NAME}"
CHARTMUSEUM_URL="${CHARTMUSEUM_URL:-http://start5g-1.cs.uit.no:3040}"
HELM_CHART_DIR="helm/rusty-llm"
DOCKERFILE_DIR="rusty_llm"
OPEN_WEBUI_DIR="open-webui"

# Get GHCR password from file or environment variable
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GHCR_PASSWORD_FILE="${GHCR_PASSWORD_FILE:-$SCRIPT_DIR/github-ghcr-pat}"

if [ -z "$GHCR_PASSWORD" ]; then
    if [ -f "$GHCR_PASSWORD_FILE" ]; then
        GHCR_PASSWORD=$(cat "$GHCR_PASSWORD_FILE" | tr -d '\n\r ')
    else
        GHCR_PASSWORD=""
    fi
fi

# Check if GHCR password is provided
if [ -z "$GHCR_PASSWORD" ]; then
    echo "Error: GHCR password is required." >&2
    echo ""
    echo "Provide it via one of the following methods:"
    echo "  1. Create a file: $GHCR_PASSWORD_FILE"
    echo "  2. Set GHCR_PASSWORD environment variable"
    echo ""
    echo "The password file should contain only the GitHub Personal Access Token."
    exit 1
fi

# Ask user if they want to build and push Docker images
read -p "Do you want to build and push the Docker images? (y/n): " BUILD_IMAGE
BUILD_IMAGE=$(echo "$BUILD_IMAGE" | tr '[:upper:]' '[:lower:]')

if [ "$BUILD_IMAGE" = "y" ] || [ "$BUILD_IMAGE" = "yes" ]; then
    echo "Logging in to GHCR..."
    echo "$GHCR_PASSWORD" | docker login ghcr.io -u "${GITHUB_USERNAME}" --password-stdin

    # Build and push Rusty LLM image
    echo ""
    echo "=== Building Rusty LLM image ==="
    docker build -t "${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}" -f "${DOCKERFILE_DIR}/Dockerfile" "${SCRIPT_DIR}"

    echo "Tagging Rusty LLM as latest (if not already)..."
    if [ "$RUSTY_LLM_VERSION" != "latest" ]; then
        docker tag "${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}" "${RUSTY_LLM_REPO}:latest"
    fi

    echo "Pushing Rusty LLM to GHCR..."
    docker push "${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}"
    if [ "$RUSTY_LLM_VERSION" != "latest" ]; then
        docker push "${RUSTY_LLM_REPO}:latest"
    fi

    # Build and push modified Open WebUI image
    echo ""
    echo "=== Building modified Open WebUI image ==="
    echo "Building with base path configured in svelte.config.js..."
    cd "${SCRIPT_DIR}/${OPEN_WEBUI_DIR}"
    
    # Get build hash from git if available
    BUILD_HASH=$(git rev-parse HEAD 2>/dev/null || echo "custom-$(date +%s)")
    
    docker build \
        --build-arg USE_CUDA=false \
        --build-arg USE_OLLAMA=false \
        --build-arg BUILD_HASH="${BUILD_HASH}" \
        -t "${OPEN_WEBUI_REPO}:${OPEN_WEBUI_VERSION}" \
        -t "${OPEN_WEBUI_REPO}:latest" \
        .

    echo "Pushing Open WebUI to GHCR..."
    docker push "${OPEN_WEBUI_REPO}:${OPEN_WEBUI_VERSION}"
    docker push "${OPEN_WEBUI_REPO}:latest"
    
    cd "${SCRIPT_DIR}"
    echo ""
else
    echo "Skipping Docker image build and push."
    echo ""
fi

echo ""
echo "Packaging Helm chart..."
# Extract chart version from Chart.yaml
CHART_VERSION=$(grep "^version:" "${HELM_CHART_DIR}/Chart.yaml" | awk '{print $2}')
CHART_NAME=$(grep "^name:" "${HELM_CHART_DIR}/Chart.yaml" | awk '{print $2}')
CHART_PACKAGE="${CHART_NAME}-${CHART_VERSION}.tgz"

# Package the Helm chart
helm package "${HELM_CHART_DIR}" --destination .

if [ ! -f "${CHART_PACKAGE}" ]; then
    echo "Error: Failed to create Helm chart package"
    exit 1
fi

echo "Pushing Helm chart to ChartMuseum at ${CHARTMUSEUM_URL}..."
# Push chart to ChartMuseum
curl -X POST \
    -F "chart=@${CHART_PACKAGE}" \
    "${CHARTMUSEUM_URL}/api/charts" || {
    echo "Warning: Failed to push chart to ChartMuseum. Is it running at ${CHARTMUSEUM_URL}?"
    echo "You can push it manually later with:"
    echo "  curl -X POST -F \"chart=@${CHART_PACKAGE}\" ${CHARTMUSEUM_URL}/api/charts"
}

# Clean up packaged chart
rm -f "${CHART_PACKAGE}"

echo ""
echo "Done! Images available at:"
echo "  Rusty LLM: ${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}"
echo "  Open WebUI: ${OPEN_WEBUI_REPO}:${OPEN_WEBUI_VERSION}"
echo "Helm chart pushed to: ${CHARTMUSEUM_URL}"
echo ""
echo "To use these images, update helm/rusty-llm/values.yaml:"
echo "  image:"
echo "    repository: ${RUSTY_LLM_REPO}"
echo "    tag: \"${RUSTY_LLM_VERSION}\""
echo ""
echo "  openWebUI:"
echo "    image:"
echo "      repository: ${OPEN_WEBUI_REPO}"
echo "      tag: \"${OPEN_WEBUI_VERSION}\""
echo "      pullPolicy: Always"

