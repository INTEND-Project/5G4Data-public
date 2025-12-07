# Upgrading to New Docker Image in Minikube

This guide explains how to upgrade the rusty-llm deployment to use a new Docker image with the embedding model.

## Step 1: Build and Push the New Image

The new image includes both the main model and the embedding model (`embed.gguf`).

```bash
# From the ai-server directory
./build-and-push.sh latest
```

When prompted, answer `y` to build and push the Docker image. This will:
- Build the Docker image with both models included
- Push it to GHCR as `ghcr.io/arne-munch-ellingsen/rusty_llm:latest`

## Step 2: Force Minikube to Pull the New Image

Since you're using `tag: "latest"` and `pullPolicy: IfNotPresent`, Minikube won't automatically pull the new image. You have two options:

### Option A: Delete the Pod (Recommended for Minikube)

This forces Kubernetes to pull the latest image:

```bash
# Set your minikube profile (if using a specific profile)
export MINIKUBE_PROFILE=inOrch-TMF-Proxy  # or your profile name

# Delete the pod to force a new pull
kubectl delete pod -n rusty-llm -l app.kubernetes.io/component=ai-server

# The deployment will automatically create a new pod with the latest image
```

### Option B: Change Pull Policy to Always

Update `helm/rusty-llm/values.yaml`:

```yaml
image:
  repository: ghcr.io/arne-munch-ellingsen/rusty_llm
  pullPolicy: Always  # Changed from IfNotPresent
  tag: "latest"
```

Then upgrade the Helm release:

```bash
helm upgrade rusty-llm helm/rusty-llm -n rusty-llm
```

**Note:** Using `Always` will pull the image on every pod restart, which is useful during development but may slow down restarts.

### Option C: Use a Version Tag (Best Practice)

Instead of using `latest`, use a specific version:

1. Build with a version tag:
   ```bash
   ./build-and-push.sh v0.6.1  # or any version number
   ```

2. Update `helm/rusty-llm/values.yaml`:
   ```yaml
   image:
     repository: ghcr.io/arne-munch-ellingsen/rusty_llm
     pullPolicy: IfNotPresent
     tag: "v0.6.1"  # Changed from latest
   ```

3. Upgrade the Helm release:
   ```bash
   helm upgrade rusty-llm helm/rusty-llm -n rusty-llm
   ```

## Step 3: Verify the Upgrade

Check that the new pod is running and has the embedding model:

```bash
# Check pod status
kubectl get pods -n rusty-llm -l app.kubernetes.io/component=ai-server

# Check if embed.gguf exists in the pod
kubectl exec -n rusty-llm $(kubectl get pod -n rusty-llm -l app.kubernetes.io/component=ai-server -o jsonpath='{.items[0].metadata.name}') -- ls -lh /app/model/embed.gguf

# Check pod logs for any errors
kubectl logs -n rusty-llm -l app.kubernetes.io/component=ai-server --tail=50
```

## Step 4: Test the Model Inference

Run the inference test to verify everything works:

```bash
./test-model-inference-runner.sh
```

You should now see a successful response from the model instead of the "Connection aborted" error.

## Troubleshooting

### Image Pull Errors

If you see `ErrImagePull` or `ImagePullBackOff`:

1. Verify the image exists in GHCR:
   ```bash
   docker pull ghcr.io/arne-munch-ellingsen/rusty_llm:latest
   ```

2. Check that the image pull secret exists:
   ```bash
   kubectl get secret ghcr-secret -n rusty-llm
   ```

3. If the secret is missing, create it:
   ```bash
   kubectl create secret docker-registry ghcr-secret \
     --docker-server=ghcr.io \
     --docker-username=arne-munch-ellingsen \
     --docker-password=<your-github-token> \
     -n rusty-llm
   ```

### Minikube Not Using Local Images

If you built the image locally and want Minikube to use it:

```bash
# Load the image into minikube
minikube image load ghcr.io/arne-munch-ellingsen/rusty_llm:latest

# Or use minikube's docker daemon
eval $(minikube docker-env)
docker build -t ghcr.io/arne-munch-ellingsen/rusty_llm:latest -f rusty_llm/Dockerfile .
```

### Still Getting Embedding Model Errors

If you still see embedding model errors after upgrading:

1. Verify the image contains the embedding model:
   ```bash
   docker run --rm ghcr.io/arne-munch-ellingsen/rusty_llm:latest ls -lh /app/model/embed.gguf
   ```

2. Check the pod's file system:
   ```bash
   kubectl exec -n rusty-llm <pod-name> -- ls -lh /app/model/
   ```

3. Rebuild the image if the file is missing:
   ```bash
   # Verify embed.gguf exists locally
   ls -lh models/embed.gguf
   
   # Rebuild and push
   ./build-and-push.sh latest
   ```

