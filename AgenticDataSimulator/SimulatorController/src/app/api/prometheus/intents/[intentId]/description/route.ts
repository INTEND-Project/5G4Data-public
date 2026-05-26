import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { lookupIntentDescription } from "@/lib/kg/lookup-intent-description";
import { validateIntentIdForPrometheusClear } from "@/lib/prometheus/client";

type RouteContext = {
  params: Promise<{
    intentId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
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

  if (targets.length === 0) {
    return NextResponse.json({ description: null });
  }

  try {
    const description = await lookupIntentDescription(targets, intentId);
    return NextResponse.json({ description });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GraphDB intent description lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
