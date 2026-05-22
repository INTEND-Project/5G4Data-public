import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { runRepositorySparqlSelect } from "@/lib/graphdb/client";
import { buildMetricCatalogQuery, parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";

const bodySchema = z.object({
  intentLocalId: z.string().min(1),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function metricNamesFromSparqlBindings(
  bindings: Array<Record<string, { value: string }>>,
): string[] {
  const names: string[] = [];
  for (const row of bindings) {
    const cell = row.metric_name ?? row.metricName;
    if (cell?.value?.length) {
      names.push(cell.value);
      continue;
    }
    const first = Object.values(row)[0];
    if (first?.value?.length) {
      names.push(first.value);
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

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

  let query: string;
  try {
    query = buildMetricCatalogQuery(target.graphIri, body.intentLocalId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metric-catalog query inputs";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const bindings = await runRepositorySparqlSelect({
      repositoryId: target.repositoryId,
      query,
    });
    const metricNames = metricNamesFromSparqlBindings(bindings);
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
        : "GraphDB metric-catalog query failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
