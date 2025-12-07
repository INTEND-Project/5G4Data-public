# Model Inference Test

This test sends a question to the rusty-llm model and verifies that it receives a streaming response.

## Test Files

### 1. Python-based Kubernetes Job Test
**File:** `test-model-inference-python.yaml`

A Kubernetes Job that uses Python to:
- Send a POST request to `/v1/chat/completions` with streaming enabled
- Parse the Server-Sent Events (SSE) stream
- Extract and display the model's response
- Verify that meaningful content was received

**Usage:**
```bash
kubectl apply -f test-model-inference-python.yaml
kubectl logs -f -l app=rusty-llm-inference-test -n rusty-llm
```

### 2. Test Runner Script
**File:** `test-model-inference-runner.sh`

A convenience script that automates running the inference test.

**Usage:**
```bash
./test-model-inference-runner.sh

# Or with a custom question:
TEST_QUESTION="What is artificial intelligence?" ./test-model-inference-runner.sh
```

### 3. Bash-based Test (Alternative)
**File:** `test-model-inference.sh`

A bash script that uses curl to test the inference endpoint. This is simpler but may have limitations with parsing SSE streams.

## Test Requirements

The test requires:
1. The rusty-llm service to be running and accessible
2. The model to be loaded and ready to process requests
3. The embedding model to be available (if RAG features are used)

## Expected Behavior

When the test runs successfully, you should see:
1. Connection to the service established
2. Request sent with the test question
3. Streaming response chunks received
4. Full response text displayed
5. Success message confirming inference is working

## Example Output

```
=== Rusty-LLM Model Inference Test ===
Service URL: http://rusty-llm.rusty-llm:8080/v1/chat/completions
Question: What is 2+2? Explain briefly.

Sending request to model...
✓ Connection successful

=== Streaming Response ===
2 + 2 equals 4. This is a basic arithmetic operation...

Received 15 chunks

=== Full Model Response ===
2 + 2 equals 4. This is a basic arithmetic operation where two is added to two, resulting in four.

Response length: 87 characters

✓ Model inference is working correctly

=== Test Result: SUCCESS ===
```

## Troubleshooting

### Connection Aborted Error
If you see "Connection aborted" or "Remote end closed connection", this typically indicates:

**Most Common Cause: Missing Embedding Model**
The rusty-llm service requires an embedding model file (`embed.gguf`) for chat completions. This file must be:
- Included in the Docker image at `model/embed.gguf`
- Or mounted as a volume if using external storage

**Check pod logs:**
```bash
kubectl logs -l app.kubernetes.io/component=ai-server -n rusty-llm
```

Look for errors like:
```
Failed to load embedding model!: NullResult
gguf_init_from_file: failed to open GGUF file 'model/embed.gguf'
```

**Solution:**
1. Download an embedding model (e.g., `bge-base-en-v1.5.Q8_0.gguf` from HuggingFace)
2. Place it in the `models/` directory as `embed.gguf`
3. Rebuild the Docker image (the Dockerfile copies `models/` to `model/` in the image)

**Other possible causes:**
- Service is not fully ready
- Model is taking too long to respond
- Resource constraints

### No Response Received
If no chunks are received:
- Verify the service is running: `kubectl get pods -n rusty-llm`
- Check service endpoints: `kubectl get endpoints rusty-llm -n rusty-llm`
- Test the models endpoint: `kubectl exec -it <pod> -n rusty-llm -- curl http://rusty-llm.rusty-llm:8080/v1/models`

### Timeout Errors
If requests timeout:
- The model may be taking too long to respond
- Increase the timeout in the test script
- Check resource limits on the rusty-llm pod

## API Format

The test uses the OpenAI-compatible API format:

```json
{
  "stream": true,
  "model": "rusty_llm",
  "messages": [
    {
      "role": "user",
      "content": "Your question here"
    }
  ]
}
```

The response is a Server-Sent Events (SSE) stream with format:
```
data: {"id":"foo","object":"chat.completion.chunk","created":1234567890,"model":"rusty_llm","choices":[{"index":0,"delta":{"content":"text chunk"},"finish_reason":null}]}

data: {"id":"foo","object":"chat.completion.chunk","created":1234567890,"model":"rusty_llm","choices":[{"index":0,"delta":{"content":" more text"},"finish_reason":null}]}

data: [DONE]
```

## Integration with CI/CD

This test can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions step
- name: Test Model Inference
  run: |
    kubectl apply -f test-model-inference-python.yaml
    kubectl wait --for=condition=complete job/rusty-llm-inference-test -n rusty-llm --timeout=180s
    kubectl logs -l app=rusty-llm-inference-test -n rusty-llm
```

