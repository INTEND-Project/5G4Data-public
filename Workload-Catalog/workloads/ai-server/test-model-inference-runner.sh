#!/bin/bash
# Script to run the Python-based model inference test

set -e

NAMESPACE="${NAMESPACE:-rusty-llm}"
TEST_QUESTION="${TEST_QUESTION:-What is 2+2?}"

echo "=== Rusty-LLM Model Inference Test Runner ==="
echo "Namespace: ${NAMESPACE}"
echo "Test Question: ${TEST_QUESTION}"
echo ""

# Check if namespace exists
if ! kubectl get namespace "${NAMESPACE}" > /dev/null 2>&1; then
    echo "Error: Namespace '${NAMESPACE}' does not exist."
    exit 1
fi

# Check if rusty-llm service exists
if ! kubectl get service rusty-llm -n "${NAMESPACE}" > /dev/null 2>&1; then
    echo "Error: Service 'rusty-llm' not found in namespace '${NAMESPACE}'."
    echo "Please deploy the rusty-llm Helm chart first."
    exit 1
fi

# Clean up any existing test job
echo "Cleaning up any existing test jobs..."
kubectl delete job rusty-llm-inference-test -n "${NAMESPACE}" --ignore-not-found=true
sleep 2

# Update the test question in the YAML if provided
if [ "${TEST_QUESTION}" != "What is 2+2? Explain briefly." ]; then
    # Create a temporary file with the updated question (only replace TEST_QUESTION value)
    sed "/- name: TEST_QUESTION$/,/value:/ s|value: \".*\"|value: \"${TEST_QUESTION}\"|" test-model-inference-python.yaml > /tmp/test-model-inference-temp.yaml
    TEST_FILE="/tmp/test-model-inference-temp.yaml"
else
    TEST_FILE="test-model-inference-python.yaml"
fi

# Apply the test job
echo "Creating inference test job..."
kubectl apply -f "${TEST_FILE}"

# Wait for the job to start
echo "Waiting for test job to start..."
kubectl wait --for=condition=Ready pod -l app=rusty-llm-inference-test -n "${NAMESPACE}" --timeout=60s || {
    echo "Error: Test job pod did not become ready in time"
    kubectl get pods -l app=rusty-llm-inference-test -n "${NAMESPACE}"
    exit 1
}

# Get the pod name
POD_NAME=$(kubectl get pod -l app=rusty-llm-inference-test -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')

echo "Test job pod: ${POD_NAME}"
echo ""
O
# Follow the logs
echo "=== Test Output ==="
kubectl logs -f "${POD_NAME}" -n "${NAMESPACE}"

# Wait for the job to complete
echo ""
echo "Waiting for test job to complete..."
kubectl wait --for=condition=complete job rusty-llm-inference-test -n "${NAMESPACE}" --timeout=180s || {
    echo ""
    echo "Error: Test job did not complete in time or failed"
    echo ""
    echo "Job status:"
    kubectl get job rusty-llm-inference-test -n "${NAMESPACE}"
    echo ""
    echo "Pod logs:"
    kubectl logs "${POD_NAME}" -n "${NAMESPACE}"
    echo ""
    echo "Pod status:"
    kubectl describe pod "${POD_NAME}" -n "${NAMESPACE}"
    exit 1
}

# Get final status
JOB_STATUS=$(kubectl get job rusty-llm-inference-test -n "${NAMESPACE}" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}')

if [ "${JOB_STATUS}" = "True" ]; then
    echo ""
    echo "=== Test Result: SUCCESS ==="
    echo "Model inference test passed!"
    exit 0
else
    echo ""
    echo "=== Test Result: FAILED ==="
    echo "Model inference test failed. Check the logs above for details."
    exit 1
fi

