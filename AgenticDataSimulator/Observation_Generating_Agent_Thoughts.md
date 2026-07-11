# Thoughts....

## Background questions

Intel (inOrch) had an idea to use CPUs for inference (since they do not have GPUs, and even argued that it could even be better along some axises, like for example sustainability). Nevertheless, the "world" tends to like using GPUs for inference... So, the work we have done with the rusty-llm model has so far been running it in a Kubernetes cluster that does not have GPU worker nodes. Will we stick to this idea (i.e. Kubernetes clusters without GPU availability)?

In our validation of inOrch we used singel node Kubernetes clusters. Given the infrastructure data we have provided this might not make sense and in a real scenario there would probably be multiple nodes and even multiple clusters. How do we address this? Should we for simplicity assume single node clusters on each edge datacenter?

What is our stand related to these questions? They are important question since they relate to which metrics we should or need to synthetically generate as training data (see next section).

## Needed/available metrics



### Kubernetes without GPUs

In this scenario, the Kubernetes cluster doesn´t have GPUs available and the most relevant metrics that influences TPS would probably be:


| Node metric                   | Typical source                         | Type    |
| ----------------------------- | -------------------------------------- | ------- |
| Node CPU utilization          | Metrics Server / kubelet summary API   | numeric |
| Node memory utilization       | Metrics Server / kubelet summary API   | numeric |
| Node memory pressure          | kube-state-metrics                     | boolean |
| Node disk pressure            | kube-state-metrics                     | boolean |
| Node ready / not ready        | kube-state-metrics                     | boolean |
| Node allocatable CPU/memory   | kube-state-metrics                     | numeric |
| Node requested CPU/memory     | kube-state-metrics + PromQL            | numeric |
| Filesystem usage              | node-exporter / cAdvisor               | numeric |
| Disk I/O latency / throughput | node-exporter                          | numeric |
| Network throughput            | cAdvisor / node-exporter / CNI metrics | numeric |




### Kubernetes with GPUs

In addition to the metrics described in the "Kubernetes without GPUs" these additional GPU related metrics are probably highly related to TPS.


| GPU / workload metric              | Typical source                              | Type    |
| ---------------------------------- | ------------------------------------------- | ------- |
| GPU utilization (SM active)        | DCGM exporter / NVIDIA GPU Operator         | numeric |
| GPU memory used / free / total     | DCGM exporter / device plugin               | numeric |
| GPU memory utilization %           | DCGM exporter                               | numeric |
| GPU temperature                    | DCGM exporter                               | numeric |
| GPU power draw                     | DCGM exporter                               | numeric |
| GPU SM / memory clock              | DCGM exporter                               | numeric |
| GPU PCIe throughput / replay count | DCGM exporter                               | numeric |
| GPU ECC errors                     | DCGM exporter                               | numeric |
| GPU allocatable / requested        | kube-state-metrics (nvidia.com/gpu)         | numeric |
| GPU pod allocation (per workload)  | device plugin / kube-state-metrics          | numeric |
| Model VRAM footprint (per pod)     | DCGM per-process / workload instrumentation | numeric |
| Inference batch size / concurrency | workload / serving metrics (e.g. vLLM)      | numeric |
| Tokens per second (TPS)            | workload exporter / Open WebUI / Ollama     | numeric |
| Time to first token (TTFT)         | workload exporter                           | numeric |
| GPU throttling / XID errors        | DCGM exporter / node logs                   | boolean |




### Minimalistic solution

Let us assume that we have single Kubernetes clusters at each edge datacenters and that the clusters have a node with GPU availability. The following table lists the four most important CPU and the four most important GPU related metrics that influences TPS.


| Category | Metric                             | Typical source                         | Type    |
| -------- | ---------------------------------- | -------------------------------------- | ------- |
| CPU      | Node CPU utilization               | Metrics Server / kubelet summary API   | numeric |
| CPU      | Node memory utilization            | Metrics Server / kubelet summary API   | numeric |
| CPU      | Node requested CPU/memory          | kube-state-metrics + PromQL            | numeric |
| CPU      | Network throughput                 | cAdvisor / node-exporter / CNI metrics | numeric |
| GPU      | GPU utilization (SM active)        | DCGM exporter / NVIDIA GPU Operator    | numeric |
| GPU      | GPU memory used / free / total     | DCGM exporter / device plugin          | numeric |
| GPU      | Inference batch size / concurrency | workload / serving metrics (e.g. vLLM) | numeric |
| GPU      | GPU power draw (throttling proxy)  | DCGM exporter                          | numeric |


**Why these eight?** TPS for LLM inference is primarily bounded by the GPU: SM utilization tells us whether the GPU is the bottleneck or sitting idle, and VRAM usage determines whether the model (and its KV cache) fits on the device at all — spilling layers to CPU is the single biggest TPS killer.

**What is SM utilization?** SM utilization is the percentage of time the GPU's *Streaming Multiprocessors* are actively executing work. SMs are the core compute units of an NVIDIA GPU — each contains the CUDA cores, tensor cores, registers and shared memory that actually run kernels (an H100 has 132). The table says "SM active" rather than plain "GPU utilization" because the two are easy to confuse: the GPU utilization reported by `nvidia-smi` only measures the fraction of time *at least one* kernel was running, so a single tiny kernel using 1 of 108 SMs still counts as 100% "utilized". SM activity (DCGM metric `DCGM_FI_PROF_SM_ACTIVE`) instead measures the fraction of SMs that are actually busy, giving a much more honest picture of compute usage. The distinction matters for TPS: LLM token generation is often memory-bandwidth-bound rather than compute-bound, so a GPU can show high "utilization" while its SMs sit waiting for weights to arrive from VRAM. Low SM activity combined with high GPU utilization signals that faster memory or better batching would improve TPS more than additional compute would. Batch size / concurrency captures the trade-off between aggregate throughput and per-request TPS, and power draw is the most practical proxy for thermal or power-cap throttling, which silently degrades clocks and therefore TPS. On the CPU side, utilization and memory matter because tokenization, sampling, scheduling and any CPU-offloaded layers run there; requested CPU/memory reflects how much headroom the scheduler has actually reserved for the inference pod (co-located workloads can starve it); and network throughput affects token streaming to clients and model pulls at deployment time.

**What is still missing in the table?** The table has no direct *outcome* metric — TPS itself (and time to first token) must be measured at the serving layer to label the training data; the eight metrics above are predictors, not the target. Other gaps: disk I/O (model load and cold-start latency), GPU temperature and clock speeds (would let us detect throttling directly instead of inferring it from power), per-pod GPU allocation on shared nodes, request-level features such as prompt/output length distributions (which strongly influence achievable TPS), and boolean health signals (node pressure, GPU XID errors) that explain sudden drops rather than gradual degradation.