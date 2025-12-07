#!/bin/bash
# Script to run the rusty-llm connectivity test in Kubernetes

set -e

NAMESPACE="${NAMESPACE:-rusty-llm}"
TEST_JOB_NAME="rusty-llm-connectivity-test"

echo "=== Rusty-LLM Connectivity Test Runner ==="
echo "Namespace: ${NAMESPACE}"
echo ""

# Check if namespace exists
if ! kubectl get namespace "${NAMESPACE}" > /dev/null 2>&1; then
    echo "Error: Namespace '${NAMESPACE}' does not exist."
    echo "Please create it first or specify a different namespace:"
    echo "  kubectl create namespace ${NAMESPACE}"
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
kubectl delete job "${TEST_JOB_NAME}" -n "${NAMESPACE}" --ignore-not-found=true
sleep 2

# Apply the test job
echo "Creating connectivity test job..."
kubectl apply -f rusty-llm-connectivity-test.yaml

# Wait for the job to start
echo "Waiting for test job to start..."
kubectl wait --for=condition=Ready pod -l app=rusty-llm-connectivity-test -n "${NAMESPACE}" --timeout=60s || {
    echo "Error: Test job pod did not become ready in time"
    kubectl get pods -l app=rusty-llm-connectivity-test -n "${NAMESPACE}"
    exit 1
}

# Get the pod name
POD_NAME=$(kubectl get pod -l app=rusty-llm-connectivity-test -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}')

echo "Test job pod: ${POD_NAME}"
echo ""

# Follow the logs
echo "=== Test Output ==="
kubectl logs -f "${POD_NAME}" -n "${NAMESPACE}"

# Wait for the job to complete
echo ""
echo "Waiting for test job to complete..."
kubectl wait --for=condition=complete job "${TEST_JOB_NAME}" -n "${NAMESPACE}" --timeout=120s || {
    echo ""
    echo "Error: Test job did not complete in time or failed"
    echo ""
    echo "Job status:"
    kubectl get job "${TEST_JOB_NAME}" -n "${NAMESPACE}"
    echo ""
    echo "Pod logs:"
    kubectl logs "${POD_NAME}" -n "${NAMESPACE}"
    echo ""
    echo "Pod status:"
    kubectl describe pod "${POD_NAME}" -n "${NAMESPACE}"
    exit 1
}

# Get final status
JOB_STATUS=$(kubectl get job "${TEST_JOB_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}')

if [ "${JOB_STATUS}" = "True" ]; then
    echo ""
    echo "=== Test Result: SUCCESS ==="
    echo "All connectivity tests passed!"
    exit 0
else
    echo ""
    echo "=== Test Result: FAILED ==="
    echo "Some connectivity tests failed. Check the logs above for details."
    exit 1
fi

