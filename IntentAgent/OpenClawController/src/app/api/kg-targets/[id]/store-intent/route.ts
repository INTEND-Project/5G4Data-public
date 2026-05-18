import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { ingestIntentTurtle } from "@/lib/graphdb/client";
import { extractIntentUuidSuffixFromTurtle } from "@/lib/intent/extract-intent-turtle";

const bodySchema = z.object({
  turtle: z.string().min(1),
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
    await ingestIntentTurtle({
      repositoryId: target.repositoryId,
      graphIri: target.graphIri,
      turtle: body.turtle,
    });
  } catch (error) {
    const message =
      typeof error === "object" &&
      error &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "GraphDB intent ingest failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const intentId = extractIntentUuidSuffixFromTurtle(body.turtle);

  return NextResponse.json({
    ok: true,
    intentId: intentId ?? null,
    graphTargetId: target.id,
  });
}
