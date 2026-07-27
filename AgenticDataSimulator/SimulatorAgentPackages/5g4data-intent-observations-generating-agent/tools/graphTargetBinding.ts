/** simulator.controller.v1 — mirrored from Controller/Agent (no cross-package import). */

export type GraphTargetBinding = {
  graphTargetId?: string;
  repositoryId: string;
  graphIri: string;
  sparqlEndpoint: string;
  repositoryBaseUrl?: string;
};

export type GraphDbEnvFallback = {
  graphDbEndpoint: string;
  graphDbNamedGraph: string;
  graphDbQueryLimit: number;
  repositoryBaseUrl?: string;
};

export function effectiveGraphDbEnv(
  binding: GraphTargetBinding | null | undefined,
  fallback: GraphDbEnvFallback
): GraphDbEnvFallback {
  if (!binding) return fallback;
  const repositoryBaseUrl =
    binding.repositoryBaseUrl ?? binding.sparqlEndpoint.replace(/\/sparql\/?$/i, "");
  return {
    graphDbEndpoint: binding.sparqlEndpoint,
    graphDbNamedGraph: binding.graphIri,
    graphDbQueryLimit: fallback.graphDbQueryLimit,
    repositoryBaseUrl
  };
}
