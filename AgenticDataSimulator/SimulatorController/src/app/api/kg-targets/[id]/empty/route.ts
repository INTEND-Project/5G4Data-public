import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { clearKnowledgeGraph } from "@/lib/graphdb/client";
import { invalidateLiteListCache } from "@/lib/intents/list-intents-cache";
import { unregisterGraphStoredIntentsForTarget } from "@/lib/intents/user-intent-registry";

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
    await clearKnowledgeGraph({
      repositoryId: target.repositoryId,
      graphIri: target.graphIri,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Knowledge graph clear failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await unregisterGraphStoredIntentsForTarget(user.id, target.id);
  invalidateLiteListCache();

  return NextResponse.json({ emptiedTargetId: target.id });
}
