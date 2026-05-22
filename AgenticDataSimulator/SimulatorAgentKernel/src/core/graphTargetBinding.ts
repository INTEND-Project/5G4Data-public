/** openclaw.controller.v1 — parsed from A2A message.metadata.openclaw */

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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export function parseGraphTargetBindingFromMetadata(metadata: unknown): GraphTargetBinding | null {
  if (!isRecord(metadata)) return null;
  const openclaw = metadata.openclaw;
  if (!isRecord(openclaw)) return null;

  const version = readNonEmptyString(openclaw.controllerBindingVersion);
  if (version && version !== "1") {
    console.warn(
      `[openclaw] Ignoring graphTarget binding with unsupported controllerBindingVersion=${version}`,
    );
    return null;
  }

  const raw = openclaw.graphTarget;
  if (!isRecord(raw)) return null;

  const repositoryId = readNonEmptyString(raw.repositoryId);
  const graphIri = readNonEmptyString(raw.graphIri);
  const sparqlEndpoint = readNonEmptyString(raw.sparqlEndpoint);
  if (!repositoryId || !graphIri || !sparqlEndpoint) return null;

  const graphTargetId = readNonEmptyString(raw.graphTargetId) ?? undefined;
  const repositoryBaseUrl = readNonEmptyString(raw.repositoryBaseUrl) ?? undefined;

  return {
    graphTargetId,
    repositoryId,
    graphIri,
    sparqlEndpoint,
    repositoryBaseUrl,
  };
}

export function bindingsConflict(
  existing: GraphTargetBinding | null | undefined,
  incoming: GraphTargetBinding,
): boolean {
  if (!existing) return false;
  return (
    existing.repositoryId !== incoming.repositoryId ||
    existing.graphIri !== incoming.graphIri ||
    existing.sparqlEndpoint !== incoming.sparqlEndpoint
  );
}
