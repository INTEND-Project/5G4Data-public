import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";
import { resolveIntentMetricCatalog } from "@/lib/kg/resolve-intent-metric-catalog";

const bodySchema = z.object({
  intentLocalId: z.string().min(1),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!parseIntentLocalIdForMetricCatalog(body.intentLocalId)) {
    return NextResponse.json(
      { error: "intentLocalId must be canonical I + 32 hex characters" },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const target = await db.knowledgeGraphTarget.findFirst({
    where: {
      id,
      userId: user.id,
    },
    select: {
      id: true,
      repositoryId: true,
      graphIri: true,
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Knowledge graph target not found" }, { status: 404 });
  }

  try {
    const metricNames = await resolveIntentMetricCatalog({
      repositoryId: target.repositoryId,
      graphIri: target.graphIri,
      intentId: body.intentLocalId,
    });
    return NextResponse.json({
      ok: true,
      metricNames,
      graphTargetId: target.id,
    });
  } catch (error) {
    const message =
      typeof error === "object" &&
      error &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "GraphDB metric-catalog resolution failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
