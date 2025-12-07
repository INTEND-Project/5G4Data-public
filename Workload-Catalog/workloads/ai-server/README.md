# AI Server - Rusty LLM with Open WebUI

This workload deploys a complete AI server solution using Rusty LLM (a Rust-based LLM inference server) with the Open WebUI frontend, deployed on Kubernetes using Helm.

## Architecture

- **Backend**: Rusty LLM - A Rust-based LLM inference server compatible with OpenAI API
- **Frontend**: Open WebUI - A custom-built web interface configured for subpath deployment at `/rusty-llm`
- **Models**: 
  - Main model: Phi-3.5-mini-instruct (GGUF format)
  - Embedding model: BGE-base-en-v1.5 (for RAG functionality)
- **Deployment**: Kubernetes via Helm chart

## Components

### Rusty LLM Backend
- Provides OpenAI-compatible API endpoints (`/v1/models`, `/v1/chat/completions`)
- Supports RAG (Retrieval Augmented Generation) with embedding model
- Includes models and data baked into the Docker image
- Exposes metrics on port 8081 for Prometheus

### Open WebUI Frontend
- Custom build with base path `/rusty-llm` configured in `svelte.config.js`
- Served from subpath `/rusty-llm` via Kubernetes Ingress
- Connects to Rusty LLM backend via internal cluster service
- Accessible at: `http://<host>:<port>/rusty-llm`

## Prerequisites

- Kubernetes cluster (tested with Minikube)
- Helm 3.x
- Docker (for building images)
- GitHub Container Registry (GHCR) access token
- Ingress controller (nginx-ingress recommended)

## Quick Start

### 1. Create Image Pull Secret

Create a secret for pulling images from GHCR:

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<your-github-username> \
  --docker-password=<your-ghcr-token> \
  -n rusty-llm
```

### 2. Build and Push Images

Build and push both the Rusty LLM and custom Open WebUI images:

```bash
./build-and-push.sh latest
```

This will:
- Build `rusty_llm` image with models and data included
- Build custom `open-webui` image with base path `/rusty-llm` configured
- Push both images to GHCR
- Package and push Helm chart to ChartMuseum

### 3. Install Helm Chart

```bash
helm install rusty-llm helm/rusty-llm -n rusty-llm --create-namespace
```

Or if using ChartMuseum:

```bash
helm repo add chartmuseum http://start5g-1.cs.uit.no:3040
helm repo update
helm install rusty-llm chartmuseum/rusty-llm -n rusty-llm --create-namespace
```

### 4. Access the Application

Once deployed, access Open WebUI at:

```
http://<your-host>:<nodeport>/rusty-llm
```

For example:
```
http://start5g-1.cs.uit.no:30872/rusty-llm
```

## Configuration

### Helm Values

Key configuration options in `helm/rusty-llm/values.yaml`:

#### Rusty LLM Backend
```yaml
image:
  repository: ghcr.io/arne-munch-ellingsen/rusty_llm
  tag: "latest"
  pullPolicy: Always

env:
  MODEL_THREADS: "12"
  DATA_PATH: "/home/data"  # Data included in image
  MODEL_MAX_TOKEN: "2048"
```

#### Open WebUI Frontend
```yaml
openWebUI:
  enabled: true
  image:
    repository: ghcr.io/arne-munch-ellingsen/open-webui
    tag: rusty-llm-subpath  # Custom build with base path configured
    pullPolicy: Always
  
  env:
    WEBUI_BASE_URL: "/rusty-llm"
    WEBUI_URL: "http://start5g-1.cs.uit.no:30872/rusty-llm"
    OPENAI_API_BASE_URL: ""  # Auto-configured to point to rusty-llm service
```

### Customizing the Base Path

The Open WebUI is configured to serve from `/rusty-llm` subpath. To change this:

1. Edit `open-webui/svelte.config.js`:
   ```javascript
   paths: {
     base: '/your-custom-path'
   }
   ```

2. Rebuild the Open WebUI image:
   ```bash
   cd open-webui
   docker build --build-arg USE_CUDA=false --build-arg USE_OLLAMA=false \
     -t ghcr.io/<username>/open-webui:custom-tag .
   ```

3. Update `helm/rusty-llm/values.yaml`:
   ```yaml
   openWebUI:
     image:
       tag: custom-tag
     env:
       WEBUI_BASE_URL: "/your-custom-path"
   ```

4. Upgrade the Helm release:
   ```bash
   helm upgrade rusty-llm helm/rusty-llm -n rusty-llm
   ```

## Testing

### Connectivity Test

Test that Open WebUI can connect to the Rusty LLM backend:

```bash
./test-connectivity.sh
```

Or manually:

```bash
kubectl apply -f rusty-llm-connectivity-test.yaml
kubectl logs -f -l app=rusty-llm-connectivity-test -n rusty-llm
```

See [CONNECTIVITY_TEST.md](CONNECTIVITY_TEST.md) for more details.

### Model Inference Test

Test that the model can generate responses:

```bash
./test-model-inference-runner.sh
```

Or manually:

```bash
kubectl apply -f test-model-inference-python.yaml
kubectl logs -f -l app=rusty-llm-inference-test -n rusty-llm
```

See [MODEL_INFERENCE_TEST.md](MODEL_INFERENCE_TEST.md) for more details.

## Upgrading

### Upgrading Images

When you rebuild and push new images:

1. Build and push:
   ```bash
   ./build-and-push.sh latest
   ```

2. Force pod restart to pull new image:
   ```bash
   kubectl delete pod -n rusty-llm -l app.kubernetes.io/component=ai-server
   kubectl delete pod -n rusty-llm -l app.kubernetes.io/component=open-webui
   ```

Or upgrade the Helm release:

```bash
helm upgrade rusty-llm helm/rusty-llm -n rusty-llm
```

See [UPGRADE_IMAGE.md](UPGRADE_IMAGE.md) for more details.

## Directory Structure

```
ai-server/
├── README.md                          # This file
├── build-and-push.sh                  # Build and push script for images and chart
├── helm/rusty-llm/                    # Helm chart
│   ├── Chart.yaml
│   ├── values.yaml                    # Configuration values
│   └── templates/                     # Kubernetes manifests
├── rusty_llm/                         # Rusty LLM source code
│   ├── Dockerfile
│   ├── src/
│   └── data/                          # Knowledge base data
├── open-webui/                        # Open WebUI source code (custom build)
│   ├── Dockerfile
│   ├── svelte.config.js              # Base path configuration
│   └── src/
├── models/                             # Model files (copied into image)
│   ├── model.gguf                     # Symlink to main model
│   ├── embed.gguf                     # Embedding model
│   └── Phi-3.5-mini-instruct-Q4_K_S.gguf
├── test-connectivity.sh               # Connectivity test script
├── test-model-inference-runner.sh     # Inference test script
├── rusty-llm-connectivity-test.yaml  # Connectivity test job
├── test-model-inference-python.yaml  # Inference test job
├── CONNECTIVITY_TEST.md               # Connectivity test documentation
├── MODEL_INFERENCE_TEST.md            # Inference test documentation
└── UPGRADE_IMAGE.md                   # Upgrade guide
```

## Troubleshooting

### Open WebUI shows 404

1. Verify the URL includes `/rusty-llm` path
2. Check ingress configuration:
   ```bash
   kubectl get ingress -n rusty-llm
   kubectl describe ingress rusty-llm-open-webui -n rusty-llm
   ```
3. Check pod logs:
   ```bash
   kubectl logs -n rusty-llm -l app.kubernetes.io/component=open-webui
   ```

### Backend connection errors

1. Verify Rusty LLM pod is running:
   ```bash
   kubectl get pods -n rusty-llm -l app.kubernetes.io/component=ai-server
   ```
2. Test connectivity:
   ```bash
   ./test-connectivity.sh
   ```
3. Check service:
   ```bash
   kubectl get svc -n rusty-llm
   kubectl describe svc rusty-llm -n rusty-llm
   ```

### Image pull errors

1. Verify image pull secret exists:
   ```bash
   kubectl get secret ghcr-secret -n rusty-llm
   ```
2. Check secret credentials:
   ```bash
   kubectl get secret ghcr-secret -n rusty-llm -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d
   ```
3. Verify image exists in GHCR:
   ```bash
   docker pull ghcr.io/arne-munch-ellingsen/rusty_llm:latest
   docker pull ghcr.io/arne-munch-ellingsen/open-webui:rusty-llm-subpath
   ```

### Model not loading

1. Check pod logs for model loading errors:
   ```bash
   kubectl logs -n rusty-llm -l app.kubernetes.io/component=ai-server
   ```
2. Verify models are in the image:
   ```bash
   kubectl exec -n rusty-llm <pod-name> -- ls -lh /app/model/
   ```
3. Ensure embedding model exists:
   ```bash
   kubectl exec -n rusty-llm <pod-name> -- ls -lh /app/model/embed.gguf
   ```

## Development

### Building Custom Open WebUI

The Open WebUI is built from source with a custom base path. To modify:

1. Edit `open-webui/svelte.config.js`:
   ```javascript
   paths: {
     base: '/your-path'
   }
   ```

2. Build the image:
   ```bash
   cd open-webui
   docker build \
     --build-arg USE_CUDA=false \
     --build-arg USE_OLLAMA=false \
     -t ghcr.io/<username>/open-webui:tag .
   ```

3. Push to registry:
   ```bash
   docker push ghcr.io/<username>/open-webui:tag
   ```

### Adding Models

Models are included in the Docker image. To add new models:

1. Place model files in `models/` directory
2. Update `rusty_llm/Dockerfile` if needed
3. Rebuild and push image:
   ```bash
   ./build-and-push.sh latest
   ```

## License

- Rusty LLM: See `rusty_llm/LICENSE`
- Open WebUI: See `open-webui/LICENSE`

## References

- [Rusty LLM Repository](https://github.com/idosb/rusty_llm)
- [Open WebUI Repository](https://github.com/open-webui/open-webui)
- [Helm Documentation](https://helm.sh/docs/)

