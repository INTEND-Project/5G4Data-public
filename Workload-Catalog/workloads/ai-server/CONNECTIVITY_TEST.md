# Rusty-LLM Connectivity Tests

This directory contains Kubernetes-based connectivity tests to verify that the rusty-llm service is properly accessible within the cluster, especially from the Open WebUI frontend.

## Test Files

### 1. Standalone Kubernetes Job Test
**File:** `rusty-llm-connectivity-test.yaml`

A Kubernetes Job that runs connectivity tests from within the cluster. This test:
- Verifies DNS resolution for the rusty-llm service
- Tests service endpoint reachability
- Validates the `/v1/models` endpoint
- Tests the connection using the same URL format that Open WebUI uses

**Usage:**
```bash
kubectl apply -f rusty-llm-connectivity-test.yaml
kubectl logs -f -l app=rusty-llm-connectivity-test -n rusty-llm
```

### 2. Test Runner Script
**File:** `test-connectivity.sh`

A convenience script that automates running the connectivity test job.

**Usage:**
```bash
./test-connectivity.sh
# Or specify a different namespace:
NAMESPACE=my-namespace ./test-connectivity.sh
```

### 3. Open WebUI Connection Test
**File:** `test-openwebui-connection.sh`

Tests the connection from the Open WebUI pod to the rusty-llm service, simulating what Open WebUI actually does.

**Usage:**
```bash
./test-openwebui-connection.sh
# Or specify a different namespace:
NAMESPACE=my-namespace ./test-openwebui-connection.sh
```

### 4. Helm Test Hook
**File:** `helm/rusty-llm/templates/connectivity-test-job.yaml`

A Helm template that can be enabled as a Helm test hook. This allows you to run connectivity tests as part of your Helm deployment workflow.

**Usage:**

1. Enable the test in `values.yaml`:
   ```yaml
   connectivityTest:
     enabled: true
   ```

2. Run the test after installation:
   ```bash
   helm test rusty-llm -n rusty-llm
   ```

3. Or configure it to run automatically after install:
   ```yaml
   connectivityTest:
     enabled: true
     hook: "post-install"  # Runs automatically after helm install
   ```

## What the Tests Verify

1. **DNS Resolution**: Ensures Kubernetes DNS can resolve the service name
2. **Service Reachability**: Verifies the service endpoint is accessible
3. **API Endpoints**: Tests the `/v1/models` endpoint returns expected data
4. **Open WebUI Compatibility**: Validates the connection using the same URL format Open WebUI uses

## Expected Results

When all tests pass, you should see:
```
=== All connectivity tests passed! ===
✓ rusty-llm service is accessible and responding correctly
```

## Troubleshooting

If tests fail:

1. **DNS Resolution Fails**:
   - Check that the service exists: `kubectl get svc rusty-llm -n rusty-llm`
   - Verify the namespace is correct

2. **Service Not Reachable**:
   - Check service endpoints: `kubectl get endpoints rusty-llm -n rusty-llm`
   - Verify pods are running: `kubectl get pods -n rusty-llm`
   - Check service selector matches pod labels

3. **API Endpoint Fails**:
   - Check pod logs: `kubectl logs -l app.kubernetes.io/component=ai-server -n rusty-llm`
   - Verify the service port matches the container port
   - Test directly from a pod: `kubectl exec -it <pod-name> -n rusty-llm -- curl http://rusty-llm.rusty-llm:8080/v1/models`

## Integration with CI/CD

These tests can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions step
- name: Run Connectivity Tests
  run: |
    kubectl apply -f rusty-llm-connectivity-test.yaml
    kubectl wait --for=condition=complete job/rusty-llm-connectivity-test -n rusty-llm --timeout=120s
    kubectl logs -l app=rusty-llm-connectivity-test -n rusty-llm
```

Or use Helm test:
```yaml
- name: Run Helm Tests
  run: |
    helm test rusty-llm -n rusty-llm
```

