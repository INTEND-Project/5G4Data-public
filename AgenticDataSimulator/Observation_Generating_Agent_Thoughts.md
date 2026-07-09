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
| GPU allocatable / requested        | kube-state-metrics (nvidia.com/gpu)       | numeric |
| GPU pod allocation (per workload)  | device plugin / kube-state-metrics          | numeric |
| Model VRAM footprint (per pod)     | DCGM per-process / workload instrumentation | numeric |
| Inference batch size / concurrency | workload / serving metrics (e.g. vLLM)      | numeric |
| Tokens per second (TPS)            | workload exporter / Open WebUI / Ollama     | numeric |
| Time to first token (TTFT)         | workload exporter                           | numeric |
| GPU throttling / XID errors        | DCGM exporter / node logs                   | boolean |

