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

export type ObservationStorageType = "graphdb" | "prometheus";

function parseStorageField(value: unknown): ObservationStorageType | null {
  const t = readNonEmptyString(value)?.toLowerCase();
  if (t === "graphdb" || t === "prometheus") return t;
  return null;
}

export type OpenClawControllerMetadata = {
  graphTarget: GraphTargetBinding | null;
  observationStorage: ObservationStorageType | null;
  createIntentStorage: ObservationStorageType | null;
};

export function parseOpenClawControllerMetadata(metadata: unknown): OpenClawControllerMetadata | null {
  if (!isRecord(metadata)) return null;
  const openclaw = metadata.openclaw;
  if (!isRecord(openclaw)) return null;

  const version = readNonEmptyString(openclaw.controllerBindingVersion);
  if (version && version !== "1") {
    console.warn(
      `[openclaw] Ignoring metadata with unsupported controllerBindingVersion=${version}`,
    );
    return null;
  }

  let graphTarget: GraphTargetBinding | null = null;
  const raw = openclaw.graphTarget;
  if (isRecord(raw)) {
    const repositoryId = readNonEmptyString(raw.repositoryId);
    const graphIri = readNonEmptyString(raw.graphIri);
    const sparqlEndpoint = readNonEmptyString(raw.sparqlEndpoint);
    if (repositoryId && graphIri && sparqlEndpoint) {
      graphTarget = {
        graphTargetId: readNonEmptyString(raw.graphTargetId) ?? undefined,
        repositoryId,
        graphIri,
        sparqlEndpoint,
        repositoryBaseUrl: readNonEmptyString(raw.repositoryBaseUrl) ?? undefined,
      };
    }
  }

  const observationStorage = parseStorageField(openclaw.observationStorage);
  const createIntentStorage = parseStorageField(openclaw.createIntentStorage);

  if (!graphTarget && !observationStorage && !createIntentStorage) return null;

  return { graphTarget, observationStorage, createIntentStorage };
}

export function parseGraphTargetBindingFromMetadata(metadata: unknown): GraphTargetBinding | null {
  return parseOpenClawControllerMetadata(metadata)?.graphTarget ?? null;
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
