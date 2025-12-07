#!/bin/bash
# Script to test Open WebUI connection to rusty-llm from outside the cluster

set -e

NAMESPACE="${NAMESPACE:-rusty-llm}"

echo "=== Open WebUI Connection Test ==="
echo "Namespace: ${NAMESPACE}"
echo ""

# Check if namespace exists
if ! kubectl get namespace "${NAMESPACE}" > /dev/null 2>&1; then
    echo "Error: Namespace '${NAMESPACE}' does not exist."
    exit 1
fi

# Check if Open WebUI pod exists
OPENWEBUI_POD=$(kubectl get pod -n "${NAMESPACE}" -l app.kubernetes.io/component=open-webui -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "${OPENWEBUI_POD}" ]; then
    echo "Error: Open WebUI pod not found in namespace '${NAMESPACE}'."
    exit 1
fi

echo "Found Open WebUI pod: ${OPENWEBUI_POD}"
echo ""

# Get Open WebUI environment variables
echo "Open WebUI Environment Variables:"
kubectl exec -n "${NAMESPACE}" "${OPENWEBUI_POD}" -- env | grep -E "OPENAI_API_BASE_URL|WEBUI_BASE_URL" || true
echo ""

# Test connection from Open WebUI pod
echo "Testing connection from Open WebUI pod to rusty-llm..."
OPENAI_URL=$(kubectl exec -n "${NAMESPACE}" "${OPENWEBUI_POD}" -- env | grep OPENAI_API_BASE_URL | cut -d= -f2 || echo "http://rusty-llm.rusty-llm:8080/v1")

if [ -z "${OPENAI_URL}" ]; then
    echo "⚠ OPENAI_API_BASE_URL not set, using default: http://rusty-llm.rusty-llm:8080/v1"
    OPENAI_URL="http://rusty-llm.rusty-llm:8080/v1"
fi

echo "Testing: ${OPENAI_URL}/models"
echo ""

RESPONSE=$(kubectl exec -n "${NAMESPACE}" "${OPENWEBUI_POD}" -- curl -s --max-time 10 "${OPENAI_URL}/models" 2>&1 || echo "ERROR")

if echo "${RESPONSE}" | grep -q "rusty_llm"; then
    echo "✓ Connection successful!"
    echo "Response: ${RESPONSE}"
    echo ""
    echo "=== Test Result: SUCCESS ==="
    exit 0
else
    echo "✗ Connection failed!"
    echo "Response: ${RESPONSE}"
    echo ""
    echo "=== Test Result: FAILED ==="
    exit 1
fi

