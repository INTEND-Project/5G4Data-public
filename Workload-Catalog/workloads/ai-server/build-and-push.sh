#!/bin/bash
# Build and push script for Rusty LLM application to GHCR and ChartMuseum
# OpenWebUI uses the standard image from ghcr.io/open-webui/open-webui:main

set -e

# Configuration
GITHUB_USERNAME="${GITHUB_USERNAME:-arne-munch-ellingsen}"
RUSTY_LLM_IMAGE_NAME="rusty_llm"
RUSTY_LLM_VERSION="${1:-latest}"
RUSTY_LLM_REPO="ghcr.io/${GITHUB_USERNAME}/${RUSTY_LLM_IMAGE_NAME}"
CHARTMUSEUM_URL="${CHARTMUSEUM_URL:-http://start5g-1.cs.uit.no:3040}"
HELM_CHART_DIR="helm/rusty-llm"
DOCKERFILE_DIR="rusty_llm"

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

# Ask user which components to build
echo "Which components do you want to build?"
echo "  1) Only Rusty LLM (default - OpenWebUI uses standard image)"
echo "  2) Skip Docker builds (only package Helm chart)"
read -p "Enter choice [1-2] (default: 1): " BUILD_CHOICE
BUILD_CHOICE=${BUILD_CHOICE:-1}

BUILD_RUSTY_LLM=false
BUILD_OPEN_WEBUI=false

case "$BUILD_CHOICE" in
    1)
        BUILD_RUSTY_LLM=true
        ;;
    2)
        echo "Skipping Docker image builds."
        ;;
    *)
        echo "Invalid choice. Building Rusty LLM only."
        BUILD_RUSTY_LLM=true
        ;;
esac

if [ "$BUILD_RUSTY_LLM" = true ] || [ "$BUILD_OPEN_WEBUI" = true ]; then
    echo "Logging in to GHCR..."
    echo "$GHCR_PASSWORD" | docker login ghcr.io -u "${GITHUB_USERNAME}" --password-stdin
fi

if [ "$BUILD_RUSTY_LLM" = true ]; then
    # Delete old local Rusty LLM images
    echo ""
    echo "=== Cleaning up old Rusty LLM images ==="
    docker rmi "${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}" 2>/dev/null || true
    if [ "$RUSTY_LLM_VERSION" != "latest" ]; then
        docker rmi "${RUSTY_LLM_REPO}:latest" 2>/dev/null || true
    fi
    echo "Old Rusty LLM images removed (if they existed)."
    
    # Build and push Rusty LLM image
    echo ""
    echo "=== Building Rusty LLM image ==="
    docker build --no-cache -t "${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}" -f "${DOCKERFILE_DIR}/Dockerfile" "${SCRIPT_DIR}"

    echo "Tagging Rusty LLM as latest (if not already)..."
    if [ "$RUSTY_LLM_VERSION" != "latest" ]; then
        docker tag "${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}" "${RUSTY_LLM_REPO}:latest"
    fi

    echo "Pushing Rusty LLM to GHCR..."
    docker push "${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}"
    if [ "$RUSTY_LLM_VERSION" != "latest" ]; then
        docker push "${RUSTY_LLM_REPO}:latest"
    fi
    echo ""
fi

# OpenWebUI now uses standard image from ghcr.io/open-webui/open-webui
# No custom build needed

echo ""
echo "Packaging Helm chart..."

# Extract chart name and current version from Chart.yaml
CHART_NAME=$(grep "^name:" "${HELM_CHART_DIR}/Chart.yaml" | awk '{print $2}')
CURRENT_VERSION=$(grep "^version:" "${HELM_CHART_DIR}/Chart.yaml" | awk '{print $2}')

# Increment patch version (e.g., 0.1.0 -> 0.1.1, 0.1.1 -> 0.1.2)
IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR=${VERSION_PARTS[0]}
MINOR=${VERSION_PARTS[1]}
PATCH=${VERSION_PARTS[2]}
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"

echo "Incrementing chart version: ${CURRENT_VERSION} -> ${NEW_VERSION}"

# Update Chart.yaml with new version
sed -i "s/^version: ${CURRENT_VERSION}/version: ${NEW_VERSION}/" "${HELM_CHART_DIR}/Chart.yaml"

# Verify the version was updated
UPDATED_VERSION=$(grep "^version:" "${HELM_CHART_DIR}/Chart.yaml" | awk '{print $2}')
if [ "$UPDATED_VERSION" != "$NEW_VERSION" ]; then
    echo "Error: Failed to update chart version"
    exit 1
fi

CHART_VERSION=$NEW_VERSION
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
if [ "$BUILD_RUSTY_LLM" = true ]; then
    echo "  Rusty LLM: ${RUSTY_LLM_REPO}:${RUSTY_LLM_VERSION}"
fi
echo "  Open WebUI: Using standard image from ghcr.io/open-webui/open-webui:main"
echo "Helm chart (version ${CHART_VERSION}) pushed to: ${CHARTMUSEUM_URL}"
echo ""
if [ "$BUILD_RUSTY_LLM" = true ]; then
    echo "To use the Rusty LLM image, update helm/rusty-llm/values.yaml:"
    echo "  image:"
    echo "    repository: ${RUSTY_LLM_REPO}"
    echo "    tag: \"${RUSTY_LLM_VERSION}\""
fi

