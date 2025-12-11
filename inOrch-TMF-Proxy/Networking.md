# Networking
The following ports are used:
**40xx**:  where xx is substituted with the datacenter number. This is the external port the individual clusters TMF API is served on (inServ can look up the exact url (including the port) in GraphDB, since it is part of the infrastructure description).

**300xx**: Internal nodeports (40xx externally maps to this port internally in the cluster). All clusters could probably just use the same Nodeport (e.g. 30001) since the internal nodeport is not visible externally.

**327xx**: The ingress nodeport, that is used for helm deployments that can be served using subpaths (e.g. rusty-llm API port is mapped to 327xx/rusty-llm-ext) (se /home/telco/arneme/INTEND-Project/5G4Data-public/Workload-Catalog/workloads/ai-server/query_rusty_llm.py).

**30xxx**: External Nodeports used to map services that cannot be served using subpaths. 10 Nodeports are reserved for each clusters usage.The range starts from 30100 and stops at 30500. Example: for EC21 the range will be 30301:30310 (30100 + 10x20 + 1) to (30100 + 10x21)

**909xx**: The individual clusters Prometheus port

