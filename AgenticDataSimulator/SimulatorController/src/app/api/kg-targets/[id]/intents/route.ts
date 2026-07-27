import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { parseGraphDbBaseUrlInput } from "@/lib/graphdb/resolve-base-url";
import { listIntentsForKgTarget } from "@/lib/kg/list-intents-for-target";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const graphDbBaseUrlParam = new URL(request.url).searchParams.get("graphDbBaseUrl")?.trim();
  let graphDbBaseUrl: string | undefined;
  if (graphDbBaseUrlParam) {
    const parsed = parseGraphDbBaseUrlInput(graphDbBaseUrlParam);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    graphDbBaseUrl = parsed.url;
  }

  try {
    const intents = await listIntentsForKgTarget({
      repositoryId: target.repositoryId,
      graphIri: target.graphIri,
      graphDbBaseUrl,
    });
    return NextResponse.json({ intents, graphTargetId: target.id });
  } catch (error) {
    const message =
      typeof error === "object" &&
      error &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "GraphDB intent list failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
