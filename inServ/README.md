## inServ – INTEND 5G4DATA Intent Management Service

Python/Flask microservice that implements TMF921 Intent Management APIs and can deploy auxiliary workloads to the same Kubernetes cluster.

### Repository Layout
- `5g4dataAPI.yaml` – source OpenAPI specification
- `src/` – generated Flask server scaffold plus custom logic
- `Dockerfile` – production image definition
- `charts/inServ/` – Helm chart for Kubernetes deployments
- `k8s/` – vanilla Kubernetes manifests (Deployment, Service, RBAC, ConfigMap, Secret)

### Prerequisites
- Python 3.11+
- Node.js (for `npx @openapitools/openapi-generator-cli`)
- Docker & Kubernetes/Helm (optional for deployment)

### Regenerating the API Scaffold
Whenever `5g4dataAPI.yaml` changes, regenerate the Flask scaffold:

```bash
cd /home/telco/arneme/INTEND-Project/5G4Data-public/inServ
npx @openapitools/openapi-generator-cli generate \
  -i 5g4dataAPI.yaml \
  -g python-flask \
  -o src \
  --additional-properties=packageName=inserv,title=inServAPI
```

After regeneration, re-apply local customizations (health endpoints, services, etc.) if generators overwrote them.

### Running Locally
```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r src/requirements.txt
export INSERV_PORT=3020
python -m inserv
```

Swagger UI will be available at `http://localhost:3020/ui/`.

### Container Image
```bash
docker build -t inserv:local .
docker run -p 3020:3020 --env LOG_LEVEL=DEBUG inserv:local
```

### Kubernetes Deployment with Helm

Push the image to GitHub Container Registry first (requires a PAT with `write:packages` scope):

```bash
docker build -t ghcr.io/arne-munch-ellingsen/inserv:latest .
echo '<GITHUB_PAT>' | docker login ghcr.io -u <your-github-user> --password-stdin
docker push ghcr.io/arne-munch-ellingsen/inserv:latest
```

```bash
helm install inserv charts/inServ \
  --namespace intend --create-namespace \
  --set image.repository=ghcr.io/arne-munch-ellingsen/inserv \
  --set image.tag=latest \
  --set env.KUBE_NAMESPACE=intend
```

Key Helm values:
- `image.*` – container repository/tag/pull policy
- `env.*` – propagated as ConfigMap environment variables
- `secretEnv.*` – stored in a Secret
- `resources` – pod resource requests/limits
- `livenessProbe` / `readinessProbe` – configurable probe paths and timings

Alternatively, apply the raw manifests:

```bash
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

### Configuration
Environment variables (set via ConfigMap/Secret or Docker env):
- `INSERV_HOST` / `INSERV_PORT` – bind address and port
- `LOG_LEVEL` – logging verbosity
- `ENABLE_K8S` – toggle Kubernetes workload deployment
- `KUBE_NAMESPACE` – namespace for spawned workloads
- `WORKLOAD_IMAGE`, `WORKLOAD_PULL_POLICY`, `WORKLOAD_SERVICE_ACCOUNT` – workload defaults

Health probe: `GET /healthz`


