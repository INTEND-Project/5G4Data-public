# inOrch-TMF-Proxy – INTEND 5G4DATA Intent Management Service

Python/Flask microservice that implements TMF921 Intent Management APIs and can deploy auxiliary workloads to the same Kubernetes cluster, each deployment is created in its own namespace. IDO and planner is also installed in the same cluster.

## Setting up a cluster and making it available over TMF 921.

The `setup-cluster-from-scratch.sh` script automates the complete setup of a minikube cluster with all required components for inOrch-TMF-Proxy. It performs the following steps:

### What the script does:

1. **Prerequisites Check**: Verifies that required tools (minikube, kubectl, docker, helm) are installed.

2. **Cluster Creation**: 
   - Creates a new minikube cluster (or reuses existing one if found)
   - Configures the cluster with appropriate resources (16 CPUs, 24GB memory)
   - Labels the node for ingress controller scheduling

3. **Ingress Configuration**:
   - Enables the ingress addon
   - Configures the ingress controller to use NodePort 30872
   - Sets up external IP access and iptables forwarding for external connectivity

4. **Chart Server Access**:
   - Creates a Kubernetes service to expose the chart server running on the host
   - Configures firewall rules to allow pods to access the chart server on port 3040

5. **DNS Configuration**:
   - Fixes DNS resolution in both CoreDNS and the minikube node
   - Ensures pods can resolve external hostnames (e.g., ghcr.io for pulling images)

6. **IDO Installation** (optional):
   - Installs Intent Driven Orchestration components if `--ido-repo-path` is provided

7. **GHCR Credentials**:
   - Creates a Kubernetes secret with GitHub Container Registry credentials
   - This allows pods to pull private images from GHCR

8. **Proxy Deployment**:
   - Builds the Docker image for inOrch-TMF-Proxy
   - Loads the image into minikube
   - Deploys the proxy using Helm

9. **Port Forwarding** (optional):
   - Sets up systemd service for persistent port forwarding to access the proxy locally

10. **Ingress Forwarding** (optional):
    - Configures iptables rules for external access to the ingress controller

11. **Verification**:
    - Checks cluster status, DNS resolution, ingress controller, and proxy deployment
    - Verifies chart server reachability

### Usage:

```bash
# Full setup with IDO
./setup-cluster-from-scratch.sh --ido-repo-path /path/to/intent-driven-orchestration --ghcr-password ghp_your_token

# Setup without IDO
./setup-cluster-from-scratch.sh --skip-ido --ghcr-password ghp_your_token

# See all options
./setup-cluster-from-scratch.sh --help
```

### Command-line Options:

- `--ido-repo-path PATH`: Path to IDO repository (optional)
- `--ghcr-username USER`: GitHub username for GHCR (default: arne-munch-ellingsen)
- `--ghcr-password TOKEN`: GitHub Personal Access Token for GHCR (required)
- `--ghcr-email EMAIL`: Email for GHCR secret
- `--profile PROFILE`: Minikube profile name (default: inOrch-TMF-Proxy)
- `--skip-ido`: Skip IDO installation
- `--skip-port-forward`: Skip systemd port-forwarding setup
- `--skip-ingress-forward`: Skip ingress forwarding setup
- `--force-recreate`: Force recreation of existing minikube profile

You should now have a complete minikube cluster with IDO+planner and the proxy. The proxy implements the TMF921 Intent Management API and will deploy the workloads mentioned in the received intent in a separate namespace in the cluster.

## Build and deploy
Use the provided script to build and (re)deploy inOrch-TMF-Proxy:
```bash
./build-and-deploy.sh
```

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
kubectl top pods -n inorch-tmf-proxy
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


