import { db } from "@/lib/db";
import { fetchIntentTurtle } from "@/lib/kg/fetch-intent-turtle";
import {
  buildIntentDescriptionQuery,
  descriptionFromSparqlBindings,
} from "@/lib/kg/intent-description-query";
import { runRepositorySparqlSelect } from "@/lib/graphdb/client";
import { parseGraphDbBaseUrlInput, resolveGraphDbBaseUrl } from "@/lib/graphdb/resolve-base-url";
import { validateIntentIdForPrometheusClear } from "@/lib/prometheus/client";
import {
  buildTmf921CreateIntentPayload,
  type Tmf921CreateIntentBody,
} from "@/lib/tools/build-tmf921-create-intent";
import { isExtraFunctionalToolId, type ExtraFunctionalToolId } from "@/lib/tools/extra-functional-tools";

export type PrepareIntentForToolInput = {
  userId: string;
  kgTargetId: string;
  intentId: string;
  toolId: string;
  graphDbBaseUrl?: string | null;
};

export type PrepareIntentForToolResult = {
  intentId: string;
  toolId: ExtraFunctionalToolId;
  payload: Tmf921CreateIntentBody;
  turtle: string;
};

export class PrepareIntentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PrepareIntentError";
  }
}

async function lookupDescriptionForTarget(input: {
  repositoryId: string;
  graphIri: string;
  intentId: string;
  graphDbBaseUrl?: string | null;
}): Promise<string | null> {
  let query: string;
  try {
    query = buildIntentDescriptionQuery(input.graphIri, input.intentId);
  } catch {
    return null;
  }

  try {
    const bindings = await runRepositorySparqlSelect({
      repositoryId: input.repositoryId,
      query,
      graphDbBaseUrl: input.graphDbBaseUrl,
    });
    return descriptionFromSparqlBindings(bindings);
  } catch {
    return null;
  }
}

export async function prepareIntentForTool(
  input: PrepareIntentForToolInput,
): Promise<PrepareIntentForToolResult> {
  if (!isExtraFunctionalToolId(input.toolId)) {
    throw new PrepareIntentError("Invalid toolId", 400);
  }

  const canonicalIntentId = validateIntentIdForPrometheusClear(input.intentId);
  if (!canonicalIntentId) {
    throw new PrepareIntentError("intentId must be canonical I + 32 hex characters", 400);
  }

  if (input.graphDbBaseUrl?.trim()) {
    const parsed = parseGraphDbBaseUrlInput(input.graphDbBaseUrl);
    if (!parsed.ok) {
      throw new PrepareIntentError(parsed.error, 400);
    }
  }

  const target = await db.knowledgeGraphTarget.findFirst({
    where: {
      id: input.kgTargetId,
      userId: input.userId,
    },
    select: {
      repositoryId: true,
      graphIri: true,
    },
  });

  if (!target) {
    throw new PrepareIntentError("Knowledge graph target not found", 404);
  }

  const graphDbBaseUrl = resolveGraphDbBaseUrl(input.graphDbBaseUrl);
  const turtle = await fetchIntentTurtle({
    repositoryId: target.repositoryId,
    graphIri: target.graphIri,
    intentId: canonicalIntentId,
    graphDbBaseUrl,
  });

  if (!turtle) {
    throw new PrepareIntentError("Intent not found in knowledge graph", 404);
  }

  const description = await lookupDescriptionForTarget({
    repositoryId: target.repositoryId,
    graphIri: target.graphIri,
    intentId: canonicalIntentId,
    graphDbBaseUrl: input.graphDbBaseUrl,
  });

  const payload = buildTmf921CreateIntentPayload({
    turtle,
    toolId: input.toolId,
    intentId: canonicalIntentId,
    description,
  });

  return {
    intentId: canonicalIntentId,
    toolId: input.toolId,
    payload,
    turtle: payload.expression.expressionValue,
  };
}
