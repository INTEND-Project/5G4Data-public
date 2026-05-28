import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { listIntentsForDomain } from "@/lib/intents/list-intents";
import { listOwnedIntentIdsForUser } from "@/lib/intents/user-intent-registry";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const ownedIntentIds = await listOwnedIntentIdsForUser(user.id, domain);
  const lite = searchParams.get("lite") === "1" || searchParams.get("lite") === "true";
  const cacheKey = lite
    ? `${user.id}:${domain}:${ownedIntentIds.join(",")}:${targets.map((target) => `${target.repositoryId}|${target.graphIri}`).join(";")}`
    : undefined;

  try {
    const intents = await listIntentsForDomain(targets, {
      mode: lite ? "lite" : "full",
      cacheKey,
      ownedIntentIds,
      grafanaLoginUsername: user.username,
    });
    return NextResponse.json({ intents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intent discovery failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
