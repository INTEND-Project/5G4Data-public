# inServ: IDO Planner Deployment Guide

This document describes the changes made to successfully deploy the IDO (Intent Driven Orchestration) planner to a Kubernetes cluster, specifically for the inServ integration project.

## Overview

The planner has been modified to:
- Pull the container image from GitHub Container Registry (GHCR) instead of a local registry
- Deploy all IDO resources in a dedicated `ido` namespace for better isolation
- Use Kubernetes secrets for authenticating with GHCR to pull private images

## Prerequisites

1. **Kubernetes cluster** (tested with minikube)
2. **kubectl** configured to access your cluster
3. **Docker** or compatible container runtime for building images
4. **GitHub Personal Access Token (PAT)** with `read:packages` permission
5. **GitHub account** with access to push to GHCR

## Changes Made to Manifest

The following changes were made to `artefacts/deploy/manifest.yaml`:

### 1. Namespace Configuration

Added `namespace: ido` to all resources to ensure they are deployed in a dedicated namespace:
- `planner-configmap` ConfigMap
- `planner-queries-configmap` ConfigMap
- `planner-service-account` ServiceAccount
- `planner-mongodb` Pod
- `planner-mongodb-service` Service
- `plugin-manager-service` Service
- `planner` Pod

### 2. Image Pull Configuration

- **Image source**: Changed to `ghcr.io/arne-munch-ellingsen/planner:0.4.0`
- **Image pull secrets**: Added `imagePullSecrets` to the ServiceAccount to authenticate with GHCR:
  ```yaml
  apiVersion: v1
  kind: ServiceAccount
  metadata:
    name: planner-service-account
    namespace: ido
  imagePullSecrets:
    - name: ghcr-secret
  ```

This approach is cleaner than adding `imagePullSecrets` to individual Pods, as all pods using this ServiceAccount will automatically inherit the credentials.

## Building and Pushing the Image

### 1. Build the Planner Image

Using the provided Makefile:
```bash
make controller-images
```

This builds the image as `planner:0.4.0` locally.

### 2. Tag for GHCR

Tag the image for GHCR (replace `arne-munch-ellingsen` with your GitHub username):
```bash
docker tag planner:0.4.0 ghcr.io/arne-munch-ellingsen/planner:0.4.0
```

### 3. Authenticate with GHCR

Login to GHCR using your GitHub Personal Access Token:
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u arne-munch-ellingsen --password-stdin
```

Or if you have the token in a file:
```bash
cat .github-token | docker login ghcr.io -u arne-munch-ellingsen --password-stdin
```

### 4. Push to GHCR

```bash
docker push ghcr.io/arne-munch-ellingsen/planner:0.4.0
```

### 5. Verify Image is Accessible

Test that you can pull the image:
```bash
docker pull ghcr.io/arne-munch-ellingsen/planner:0.4.0
```

## Deployment Steps

### Step 1: Create the Namespace (if it does not exist)

```bash
kubectl create namespace ido
```

### Step 2: Create GHCR Secret

Create a Kubernetes secret with your GHCR credentials:

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_TOKEN \
  --docker-email=not-used@example.com \
  -n ido
```

**Note**: The `--docker-email` parameter is not actually used by GHCR for authentication, but is required by the `kubectl create secret docker-registry` command. You can use any placeholder email.

### Step 3: Apply the Manifest

```bash
kubectl apply -f artefacts/deploy/manifest.yaml
```

### Step 4: Verify Deployment

Check that all pods are running:
```bash
kubectl get pods -n ido
```

Expected output:
```
NAME              READY   STATUS    RESTARTS   AGE
planner           1/1     Running   0          XXs
planner-mongodb   1/1     Running   0          XXs
```

Check the planner pod logs to ensure it started correctly:
```bash
kubectl logs -n ido planner
```

## Troubleshooting

### ErrImagePull Error

If you encounter `ErrImagePull` errors:

1. **Verify the secret exists**:
   ```bash
   kubectl get secret ghcr-secret -n ido
   ```

2. **Check the ServiceAccount has the imagePullSecrets reference**:
   ```bash
   kubectl get serviceaccount planner-service-account -n ido -o yaml
   ```

3. **Verify the image exists and is accessible**:
   ```bash
   docker pull ghcr.io/arne-munch-ellingsen/planner:0.4.0
   ```

4. **Check pod events for detailed error messages**:
   ```bash
   kubectl describe pod planner -n ido
   ```

### Namespace Issues

If resources are not found:

1. **Verify the namespace exists**:
   ```bash
   kubectl get namespace ido
   ```

2. **Check resources are in the correct namespace**:
   ```bash
   kubectl get all -n ido
   ```

### Re-deploying After Changes

To clean up and redeploy:

```bash
# Delete pods
kubectl delete pod planner planner-mongodb -n ido

# Delete services
kubectl delete service planner-mongodb-service plugin-manager-service -n ido

# Delete configmaps
kubectl delete configmap planner-configmap planner-queries-configmap -n ido

# Delete serviceaccount
kubectl delete serviceaccount planner-service-account -n ido

# Reapply manifest
kubectl apply -f artefacts/deploy/manifest.yaml
```

**Note**: The `ClusterRole` and `ClusterRoleBinding` are cluster-scoped and don't need to be deleted.

## Namespace Isolation

### Important Notes

The planner operates **cluster-wide** and can manage workloads in **any namespace**, not just the `ido` namespace. This is because:

1. **ClusterRole Permissions**: The planner uses a `ClusterRole` (not a `Role`), which grants cluster-wide permissions:
   - Can `get`, `list`, `watch`, `patch`, `update`, `delete` pods in any namespace
   - Can `get`, `patch`, `update` deployments and replicasets in any namespace
   - Can access custom resources (`intents`, `kpiprofiles`) in any namespace

2. **Network Communication**: By default, Kubernetes allows pods in different namespaces to communicate. NetworkPolicies can restrict this if needed.

3. **Workload Management**: The planner manages workloads based on `Intent` resources (custom CRDs). The `TargetKey` in an Intent specifies the namespace and name of the workload (e.g., `default/my-app` or `production/api-server`).

### Implications

- ✅ Third-party workloads can be deployed in separate namespaces
- ✅ The planner can manage workloads across all namespaces
- ✅ The planner only acts on workloads specified in `Intent` resources
- ✅ Network communication works across namespaces by default

This design is appropriate for an orchestration system that needs to manage workloads across the entire cluster.

## Additional Resources

- [IDO Getting Started Guide](docs/getting_started.md)
- [IDO Framework Documentation](docs/framework.md)
- [IDO Planner Documentation](docs/planner.md)
- [IDO Actuators Documentation](docs/actuators.md)

## Version Information

- **Planner Image Version**: 0.4.0
- **Manifest Last Updated**: Based on `artefacts/deploy/manifest.yaml`
- **Kubernetes Version**: Tested with minikube (Kubernetes 1.x)

