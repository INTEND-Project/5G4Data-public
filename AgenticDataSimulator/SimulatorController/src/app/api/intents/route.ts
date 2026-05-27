import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { listIntentsForDomain } from "@/lib/intents/list-intents";

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

  try {
    const intents = await listIntentsForDomain(targets);
    return NextResponse.json({ intents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intent discovery failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
