## inServ – INTEND 5G4DATA Intent Management Service

Python/Flask microservice that implements TMF921 Intent Management APIs and can deploy auxiliary workloads to the same Kubernetes cluster.

## Intel IDO setup
For inServ we will use minikube to set up a single node Kubernetes cluster that we can install IDO in. More about minikube can be found [here](https://minikube.sigs.k8s.io/docs/). To create a cluster for inServ/inOrch do this:
```bash
minikube start --driver=docker --cpus=16 --memory=24G
```
Intel IDO can be found [here](https://github.com/intel/intent-driven-orchestration/tree/main).
Clone the repository and make it ready:
```bash
mkdir Intel-IDO
cd Intel-IDO
# Clone the IDO repo
github repo clone intel/intent-driven-orchestration
```
See inServ-IDO-README.md for modifications done to the IDO source for inServ. When these changes are made, proceed with:
```bash
cd intent-driven-orchestration/
# Install the IDO CRDs and the IDO planner
kubectl apply -f artefacts/intents_crds_v1alpha1.yaml
kubectl apply -f artefacts/deploy/manifest.yaml
```
The minikube cluster is ready and all IDO resources are deployed to it (except KPI profiles, more about that later.)

### inServ repository Layout
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

### Running Locally (for testing inServ only, see Kubernetes instructions further down for PoC integration with other Intend tools)
```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r src/requirements.txt
export INSERV_PORT=3020
python -m inserv
```

Swagger UI will be available at `http://localhost:3020/ui/`.

The Connexion app now serves the full TM Forum TMF921 Intent Management specification. All intent/report/hub operations documented by TM Forum are exposed under `/tmf-api/intentManagement/v5`.

### Container Image
```bash
docker build -t inserv:local .
docker run --name inserv-local -p 3020:3020 --env LOG_LEVEL=DEBUG inserv:local
```

### Kubernetes Deployment with Helm

Push the image to GitHub Container Registry first (requires a PAT with `write:packages` scope):

```bash
docker build -t ghcr.io/arne-munch-ellingsen/inserv:latest .
echo '<GITHUB_PAT>' | docker login ghcr.io -u <your-github-user> --password-stdin
docker push ghcr.io/<your-github-user>/inserv:latest
```

If your kubeconfig is not stored at `~/.kube/config`, point `kubectl` and `helm` at the right file before deploying:

```bash
export KUBECONFIG=/path/to/cluster.conf
kubectl config use-context intend-cluster
```

If your registry requires authentication (e.g., private GHCR repo), create a pull-secret in the target namespace and reference it via the new `imagePullSecrets` value:

```bash
kubectl create namespace inserv
kubectl -n inserv create secret docker-registry ghcr-creds \
  --docker-server=ghcr.io \
  --docker-username=<your-github-user> \
  --docker-password='<GITHUB_PAT>' \
  --docker-email=you@example.com

kubectl -n inserv describe secret ghcr-creds  # verify it exists

helm install inserv charts/inServ \
  --namespace inserv --create-namespace \
  --set image.repository=ghcr.io/<your-github-user>/inserv \
  --set image.tag=latest \
  --set env.KUBE_NAMESPACE=inserv \
  --set imagePullSecrets[0]=ghcr-creds
```

> The `ghcr-creds` secret lives only in the Kubernetes cluster. If you delete
> the `inserv` namespace or deploy to another cluster, recreate the secret
> before running Helm again. For public GHCR images you can skip this step and
> omit `imagePullSecrets`.

```bash
helm install inserv charts/inServ \
  --namespace inserv --create-namespace \
  --set image.repository=ghcr.io/<your-github-user>/inserv \
  --set image.tag=latest \
  --set env.KUBE_NAMESPACE=inserv
```

Key Helm values:
- `image.*` – container repository/tag/pull policy
- `service.*` – service type/ports (defaults to ClusterIP; expose externally via port-forward below)
- `env.*` – propagated as ConfigMap environment variables
- `secretEnv.*` – stored in a Secret
- `resources` – pod resource requests/limits
- `livenessProbe` / `readinessProbe` – configurable probe paths and timings

### TMF921 intent reports & event subscriptions

- List reports for an intent:
  ```bash
  curl http://<host>:3020/tmf-api/intentManagement/v5/intent/<intentId>/intentReport
  ```
- Retrieve/delete a specific report:
  ```bash
  curl http://<host>:3020/tmf-api/intentManagement/v5/intent/<intentId>/intentReport/<reportId>
  curl -X DELETE http://<host>:3020/tmf-api/intentManagement/v5/intent/<intentId>/intentReport/<reportId>
  ```
- Register a hub (event subscription) to receive TMF notifications:
  ```bash
  curl -X POST http://<host>:3020/tmf-api/intentManagement/v5/hub \
    -H "Content-Type: application/json" \
    -d '{
      "callback": "https://intent-owner.example.com/notifications",
      "eventTypes": ["IntentReportCreateEvent","IntentStatusChangeEvent"],
      "query": "intentId=<intentId>"
    }'
  ```
  Hubs can be retrieved or removed via `GET/DELETE /hub/{id}`. The service will POST TMF-compliant payloads to the callback URL whenever matching intent or report events occur (state changes, observation reports, etc.).
- For testing, `/tmf-api/intentManagement/v5/listener/*` endpoints simply log and acknowledge events so you can point TMF simulators at inServ.

Observation reports are generated automatically every `OBSERVATION_INTERVAL_SECONDS` seconds while an intent is active. Metrics are stored via the internal repository and surfaced through the API/hub.

#### External access via persistent port-forward (systemd)

Run a long-lived port-forward on the host using the provided `systemd-portforward-inserv.service` unit so the API stays reachable at `http://<host-ip>:3020/` (e.g., `http://start5g-1.cs.uit.no:3020/healthz`):

```bash
sudo cp systemd-portforward-inserv.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now systemd-portforward-inserv.service
sudo systemctl status systemd-portforward-inserv.service
```

The unit runs `kubectl -n inserv port-forward svc/inserv-inserv 3020:3020 --address 0.0.0.0`. Adjust `User`, `Environment=KUBECONFIG=...`, or the listen port if your setup differs. View logs with `journalctl -u systemd-portforward-inserv.service`.

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
- `REPORTING_HANDLER` / `REPORTING_OWNER` – metadata embedded in emitted intent reports
- `ENABLE_OBSERVATION_REPORTS` – enable/disable periodic observation metrics (default `true`)
- `OBSERVATION_INTERVAL_SECONDS` – cadence for observation reports (default `300`)
- `OBSERVATION_METRIC_NAME` – metric name used for generated observations

Health probe: `GET /healthz`


