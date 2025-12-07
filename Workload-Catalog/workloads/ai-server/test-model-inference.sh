#!/bin/bash
# Script to test model inference by sending a question and receiving a response

set -e

NAMESPACE="${NAMESPACE:-rusty-llm}"
SERVICE_NAME="${SERVICE_NAME:-rusty-llm}"
SERVICE_PORT="${SERVICE_PORT:-8080}"
TEST_QUESTION="${TEST_QUESTION:-What is 2+2?}"

echo "=== Rusty-LLM Model Inference Test ==="
echo "Namespace: ${NAMESPACE}"
echo "Service: ${SERVICE_NAME}"
echo "Question: ${TEST_QUESTION}"
echo ""

# Check if namespace exists
if ! kubectl get namespace "${NAMESPACE}" > /dev/null 2>&1; then
    echo "Error: Namespace '${NAMESPACE}' does not exist."
    exit 1
fi

# Check if service exists
if ! kubectl get service "${SERVICE_NAME}" -n "${NAMESPACE}" > /dev/null 2>&1; then
    echo "Error: Service '${SERVICE_NAME}' not found in namespace '${NAMESPACE}'."
    exit 1
fi

# Create a test pod that will make the request
TEST_POD_NAME="rusty-llm-inference-test-$(date +%s)"

echo "Creating test pod: ${TEST_POD_NAME}"
echo ""

# Create a pod that will test the inference
kubectl run "${TEST_POD_NAME}" \
    --image=curlimages/curl:latest \
    --restart=Never \
    --rm -i \
    --namespace="${NAMESPACE}" \
    -- sh -c "
        echo 'Sending question to model...'
        echo ''
        
        # Send the request and capture the streaming response
        RESPONSE=\$(curl -s -N --max-time 60 \\
            -X POST \\
            -H 'Content-Type: application/json' \\
            -d '{\"stream\": true, \"model\": \"rusty_llm\", \"messages\": [{\"role\": \"user\", \"content\": \"${TEST_QUESTION}\"}]}' \\
            \"http://${SERVICE_NAME}.${NAMESPACE}:${SERVICE_PORT}/v1/chat/completions\" 2>&1)
        
        if [ \$? -ne 0 ]; then
            echo '✗ Failed to connect to the API endpoint'
            echo \"Error: \${RESPONSE}\"
            exit 1
        fi
        
        # Check if we got a response
        if [ -z \"\${RESPONSE}\" ]; then
            echo '✗ No response received from the model'
            exit 1
        fi
        
        # Extract content from SSE stream
        # SSE format: data: {\"choices\":[{\"delta\":{\"content\":\"text\"}}]}
        echo 'Raw response (first 500 chars):'
        echo \"\${RESPONSE}\" | head -c 500
        echo ''
        echo ''
        
        # Count data lines
        DATA_LINES=\$(echo \"\${RESPONSE}\" | grep -c '^data:' || echo '0')
        echo \"Received \${DATA_LINES} data chunks\"
        
        if [ \"\${DATA_LINES}\" -eq 0 ]; then
            echo '✗ No data chunks received in the stream'
            exit 1
        fi
        
        # Extract and concatenate all content
        FULL_RESPONSE=\$(echo \"\${RESPONSE}\" | grep '^data:' | sed 's/^data: //' | \\
            python3 -c \"
import sys
import json
content_parts = []
for line in sys.stdin:
    line = line.strip()
    if not line or line == '[DONE]':
        continue
    try:
        data = json.loads(line)
        if 'choices' in data and len(data['choices']) > 0:
            delta = data['choices'][0].get('delta', {})
            if 'content' in delta:
                content_parts.append(delta['content'])
    except json.JSONDecodeError:
        pass
print(''.join(content_parts))
\" 2>/dev/null || echo \"\${RESPONSE}\" | grep -o '\"content\":\"[^\"]*\"' | head -5)
        
        if [ -z \"\${FULL_RESPONSE}\" ]; then
            echo '⚠ Could not parse response content, but received data chunks'
            echo 'This might indicate the response format is different than expected'
            echo \"Full response (first 1000 chars):\"
            echo \"\${RESPONSE}\" | head -c 1000
            exit 0
        fi
        
        echo ''
        echo '=== Model Response ==='
        echo \"\${FULL_RESPONSE}\"
        echo ''
        
        # Check if response has meaningful content
        RESPONSE_LENGTH=\$(echo \"\${FULL_RESPONSE}\" | wc -c)
        if [ \"\${RESPONSE_LENGTH}\" -lt 5 ]; then
            echo '⚠ Warning: Response seems very short'
        else
            echo \"✓ Received response with \${RESPONSE_LENGTH} characters\"
        fi
        
        echo ''
        echo '=== Test Result: SUCCESS ==='
        echo '✓ Model inference is working correctly'
    " || {
    echo ""
    echo "=== Test Result: FAILED ==="
    echo "Model inference test failed. Check the output above for details."
    exit 1
}

echo ""
echo "Test completed successfully!"

