/** openclaw.controller.v1 — carried on A2A user messages from Controller. */
export type GraphTargetBinding = {
  graphTargetId?: string;
  repositoryId: string;
  graphIri: string;
  sparqlEndpoint: string;
  repositoryBaseUrl?: string;
};

export type KgTargetForBinding = {
  id: string;
  repositoryId: string;
  graphIri: string;
  displayName?: string;
};

function normalizeGraphDbBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function buildGraphTargetBinding(
  target: KgTargetForBinding,
  graphDbBaseUrl: string,
): GraphTargetBinding {
  const base = normalizeGraphDbBaseUrl(graphDbBaseUrl);
  const repositoryId = target.repositoryId.trim();
  const graphIri = target.graphIri.trim();
  const repositoryBaseUrl = `${base}repositories/${encodeURIComponent(repositoryId)}`;
  return {
    graphTargetId: target.id,
    repositoryId,
    graphIri,
    sparqlEndpoint: `${repositoryBaseUrl}/sparql`,
    repositoryBaseUrl,
  };
}

export function openClawMetadataEnvelope(graphTarget: GraphTargetBinding): {
  openclaw: {
    controllerBindingVersion: "1";
    graphTarget: GraphTargetBinding;
  };
} {
  return {
    openclaw: {
      controllerBindingVersion: "1",
      graphTarget,
    },
  };
}
