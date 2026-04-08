#!/bin/bash
# Package and push the avalance-object-detection Helm chart to ChartMuseum

set -euo pipefail

CHARTMUSEUM_URL="${CHARTMUSEUM_URL:-http://start5g-1.cs.uit.no:3040}"
HELM_CHART_DIR="helm/avalance-object-detection"

if ! command -v helm >/dev/null 2>&1; then
    echo "Error: helm is not installed or not in PATH."
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is not installed or not in PATH."
    exit 1
fi

CHART_FILE="${HELM_CHART_DIR}/Chart.yaml"
if [ ! -f "${CHART_FILE}" ]; then
    echo "Error: Chart file not found at ${CHART_FILE}"
    exit 1
fi

CHART_NAME=$(awk '/^name:/ {print $2}' "${CHART_FILE}")
CURRENT_VERSION=$(awk '/^version:/ {print $2}' "${CHART_FILE}")

if [ -z "${CHART_NAME}" ] || [ -z "${CURRENT_VERSION}" ]; then
    echo "Error: Could not read chart name/version from ${CHART_FILE}"
    exit 1
fi

# Increment patch version (x.y.z -> x.y.(z+1))
IFS='.' read -r MAJOR MINOR PATCH <<< "${CURRENT_VERSION}"
if [ -z "${MAJOR}" ] || [ -z "${MINOR}" ] || [ -z "${PATCH}" ]; then
    echo "Error: Chart version must be semantic (x.y.z). Current: ${CURRENT_VERSION}"
    exit 1
fi
NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"

echo "Updating chart version: ${CURRENT_VERSION} -> ${NEW_VERSION}"
sed -i "s/^version: ${CURRENT_VERSION}/version: ${NEW_VERSION}/" "${CHART_FILE}"

UPDATED_VERSION=$(awk '/^version:/ {print $2}' "${CHART_FILE}")
if [ "${UPDATED_VERSION}" != "${NEW_VERSION}" ]; then
    echo "Error: Failed to update chart version in ${CHART_FILE}"
    exit 1
fi

CHART_PACKAGE="${CHART_NAME}-${NEW_VERSION}.tgz"

echo "Packaging Helm chart..."
helm package "${HELM_CHART_DIR}" --destination .

if [ ! -f "${CHART_PACKAGE}" ]; then
    echo "Error: Failed to create ${CHART_PACKAGE}"
    exit 1
fi

echo "Pushing chart to ${CHARTMUSEUM_URL}..."
curl -X POST -F "chart=@${CHART_PACKAGE}" "${CHARTMUSEUM_URL}/api/charts"

rm -f "${CHART_PACKAGE}"

echo ""
echo "Done."
echo "Chart: ${CHART_NAME}"
echo "Version: ${NEW_VERSION}"
echo "Pushed to: ${CHARTMUSEUM_URL}"
