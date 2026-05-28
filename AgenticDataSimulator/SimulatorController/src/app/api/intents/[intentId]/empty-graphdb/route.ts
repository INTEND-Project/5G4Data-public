import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { runRepositorySparqlUpdate } from "@/lib/graphdb/client";
import { buildClearIntentObservationsUpdate } from "@/lib/intents/clear-intent-observations-query";
import { resolveIntentOwner } from "@/lib/intents/list-intents";
import { assertUserOwnsIntent } from "@/lib/intents/user-intent-registry";
import { fetchCompoundMetricsForIntent } from "@/lib/intents/observation-time-bounds";
import { validateIntentIdForPrometheusClear } from "@/lib/prometheus/client";

type RouteContext = {
  params: Promise<{
    intentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { intentId } = await context.params;

  if (!validateIntentIdForPrometheusClear(intentId)) {
    return NextResponse.json(
      { error: "intentId must be canonical I + 32 hex characters" },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain")?.trim();

  if (!domain) {
    return NextResponse.json({ error: "domain query parameter is required" }, { status: 400 });
  }

  const ownsIntent = await assertUserOwnsIntent(user.id, intentId);
  if (!ownsIntent) {
    return NextResponse.json({ error: "Intent not found" }, { status: 404 });
  }

  const targets = await db.knowledgeGraphTarget.findMany({
    where: {
      userId: user.id,
      domain,
    },
    select: {
      repositoryId: true,
      graphIri: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const owner = await resolveIntentOwner(targets, intentId);

  if (!owner) {
    return NextResponse.json({ error: "Intent knowledge graph target not found" }, { status: 404 });
  }

  const compoundMetrics = await fetchCompoundMetricsForIntent({
    repositoryId: owner.repositoryId,
    graphIri: owner.graphIri,
    intentId,
  });

  if (compoundMetrics.length === 0) {
    return NextResponse.json(
      { error: "No condition metrics found for this intent in GraphDB" },
      { status: 404 },
    );
  }

  let query: string;
  try {
    query = buildClearIntentObservationsUpdate(owner.graphIri, compoundMetrics);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid clear query";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    await runRepositorySparqlUpdate({
      repositoryId: owner.repositoryId,
      query,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GraphDB intent observation clear failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({
    clearedIntentId: intentId,
    repositoryId: owner.repositoryId,
    graphIri: owner.graphIri,
    compoundMetrics,
  });
}
