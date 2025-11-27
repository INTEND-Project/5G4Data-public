# inServ – INTEND 5G4DATA Intent Management Service

Python/Flask microservice that implements TMF921 Intent Management APIs and can deploy auxiliary workloads to the same Kubernetes cluster.

## Kubernetes Deployment with Helm
### Setting up a cluster
We have used minikube. To create a minikube cluster with proper DNS configuration, use the provided setup script:

```bash
# Create and configure minikube cluster (recommended)
./setup-cluster.sh
```

This script will:
- Create the minikube cluster with the inOrch profile
- Configure CoreDNS to use working DNS servers (fixes DNS resolution issues)
- Verify the setup is working

Alternatively, you can create the cluster manually:
```bash
# Create minikube profile
minikube start --driver=docker --cpus=16 --memory=24G -p inOrch

# Then manually fix CoreDNS DNS forwarding (required for external DNS resolution)
kubectl get configmap coredns -n kube-system -o yaml | \
  sed 's|forward . /etc/resolv.conf|forward . 129.242.9.253 158.38.0.1 129.242.4.254|' | \
  kubectl apply -f -
kubectl rollout restart deployment/coredns -n kube-system
```

We then cloned the [IDO repo](https://github.com/INTEND-Project/intent-driven-orchestration) and made the changes described in [inServ-IDO-README.md](./inServ-IDO-README.md). After that, we followed the instructions in IDO's [README.md](https://github.com/INTEND-Project/intent-driven-orchestration/blob/main/README.md) to install IDO in the minikube cluster:
```bash
kubectl create namespace ido
kubectl apply -f artefacts/intents_crds_v1alpha1.yaml
kubectl apply -f artefacts/deploy/manifest.yaml
```

Note that when the minikube profile is up and running it can be stopped and restarted like this:
```bash
# Stop a running inOrch profile
minikube stop --profile inOrch
# Restart it (as it was when it was stopped, i.e. IDO and inServ is still in the cluster if they were deployed to it)
nohup minikube start --profile inOrch > inOrch.log 2>&1 &
```

**Important:** After restarting minikube, you may need to fix DNS in the minikube node if you encounter `ErrImagePull` errors when pulling images from external registries (like `ghcr.io`). Run:

```bash
./fix-minikube-dns.sh
```

This updates the minikube node's DNS configuration to use working DNS servers. This fix is temporary and needs to be reapplied after each minikube restart.
### Build the inServ image and deploy it  

Use the provided script to build and deploy inServ:
```bash
./build-and-deploy.sh
```
Add a ghrc secret so that inServ can pull workload images mentioned in helm charts. The intent will reference the helm chart, and the helm chart will reference the image stored in ghrc. For the PoC, this is how we will do it, and for that, inserv needs the credentials to pull images from ghrc.

```bash
kubectl -n inserv create secret docker-registry ghcr-creds \
  --docker-server=ghcr.io \
  --docker-username=<your-github-user> \
  --docker-password='<GITHUB_PAT>' \
  --docker-email=you@example.com
```


### External access via persistent port-forward (systemd)

Run a long-lived port-forward on the host using the provided `systemd-portforward-inserv.service` unit so the API stays reachable at `http://<host-ip>:3020/` (e.g., `http://start5g-1.cs.uit.no:3020/healthz`):

```bash
sudo cp systemd-portforward-inserv.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now systemd-portforward-inserv.service
sudo systemctl status systemd-portforward-inserv.service
```

The unit runs `kubectl -n inserv port-forward svc/inserv-inserv 3020:3020 --address 0.0.0.0`. Adjust `User`, `Environment=KUBECONFIG=...`, or the listen port if your setup differs. View logs with `journalctl -u systemd-portforward-inserv.service`.

### External access to deployed services via Ingress

inServ automatically creates Ingress resources for deployed services with NodePort services, enabling path-based routing through the ingress controller. However, in minikube, NodePort services are only accessible via the minikube node IP (e.g., `192.168.49.2`), not the host's external IP.

To enable external access from remote clients, set up iptables forwarding:

```bash
# Run the setup script (configures iptables forwarding)
./setup-ingress-forwarding.sh
```

This script:
- Sets up iptables rules to forward traffic from the host's external IP port 30872 to the minikube node
- Makes the rules persistent across reboots (if `netfilter-persistent` is installed)
- Enables access to all services via: `http://<host-ip>:30872/<app-name>/`

**Note:** After minikube restarts, you may need to re-run this script if the minikube node IP changes.

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

## Checking Cluster Resources

To verify that your Kubernetes cluster has sufficient resources for deploying workloads, use the following commands:

### Check Node Capacity and Allocations

```bash
# Get node capacity (CPU, memory, pods)
kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.capacity.cpu,MEMORY:.status.capacity.memory

# Get detailed node information including allocated resources
kubectl describe node inorch | grep -A 10 "Allocated resources:"

# Get node name and basic capacity
kubectl describe node | grep -E "Name:|cpu:|memory:|pods:" | head -10
```

### Check Current Resource Usage

```bash
# Check resource requests and limits for all pods
kubectl get pods --all-namespaces -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{.spec.containers[0].resources.requests.cpu}{"\t"}{.spec.containers[0].resources.requests.memory}{"\n"}{end}' | column -t

# Count running vs total pods
kubectl get pods --all-namespaces --field-selector=status.phase=Running -o wide | wc -l
kubectl get pods --all-namespaces | wc -l
```

### Real-time Resource Monitoring (if metrics-server is installed)

```bash
# Watch node resource usage
kubectl top node

# Watch pod resource usage across all namespaces
kubectl top pods --all-namespaces

# Watch pods in a specific namespace
kubectl top pods -n inserv
```

### Check Cluster Status

```bash
# Check minikube cluster status
minikube status -p inOrch

# List all minikube profiles
minikube profile list

# Check if cluster is running
kubectl cluster-info
```

### Interpreting Resource Information

- **CPU**: Shown in cores (e.g., `112` = 112 cores, `2250m` = 2.25 cores)
- **Memory**: Shown in various units (Ki, Mi, Gi) - `263768160Ki` ≈ 263 GB
- **Allocated resources**: Shows what's currently requested/limited by running pods
- **Available capacity**: Total capacity minus allocated resources

A healthy cluster typically has:
- CPU usage < 80%
- Memory usage < 80%
- Sufficient pod capacity for new deployments


