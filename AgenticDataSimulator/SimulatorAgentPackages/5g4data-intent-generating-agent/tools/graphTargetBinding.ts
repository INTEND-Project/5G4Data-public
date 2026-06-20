/** openclaw.controller.v1 — mirrored from Controller/Agent (no cross-package import). */

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
  graphDbInfraEndpoint: string;
  graphDbInfraNamedGraph: string;
  graphDbQueryLimit: number;
  repositoryBaseUrl?: string;
};
