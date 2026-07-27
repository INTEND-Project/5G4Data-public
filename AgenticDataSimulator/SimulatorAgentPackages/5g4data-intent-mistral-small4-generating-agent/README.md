# 5g4data-intent-generation

Domain package for TM Forum–style 5G4Data intent generation (workloads, locality, deployment context).

## Running the cloned agent with a custom HTTP port

After `package load` from `SimulatorAgentKernel`, run the clone with **`--port`** so multiple agents can listen on one host without conflicting on the default port:

```bash
cd ../SimulatorAgentKernel-5g4data-intent-generation
API_SERVER_ENABLED=true npx tsx src/index.ts --port 3012
```

This sets `API_SERVER_PORT` for that process only. Update Caddy (or `A2A_AGENT_BASE_URL`) if the public URL must point at the new upstream port.
