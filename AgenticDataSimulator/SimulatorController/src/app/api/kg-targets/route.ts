import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { createNamedGraph, createRepository } from "@/lib/graphdb/client";
import { buildGraphIri, buildRepositoryId } from "@/lib/graphdb/naming";
import { parseGraphDbBaseUrlInput } from "@/lib/graphdb/resolve-base-url";

const createTargetBodySchema = z.object({
  domain: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  graphDbBaseUrl: z.string().trim().optional(),
});

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain") ?? undefined;
  const targets = await db.knowledgeGraphTarget.findMany({
    where: {
      userId: user.id,
      ...(domain ? { domain } : {}),
    },
    select: {
      id: true,
      userId: true,
      domain: true,
      repositoryId: true,
      graphIri: true,
      displayName: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return NextResponse.json({ targets });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = createTargetBodySchema.parse(await request.json());
  let graphDbBaseUrl: string | undefined;
  if (body.graphDbBaseUrl?.trim()) {
    const parsed = parseGraphDbBaseUrlInput(body.graphDbBaseUrl);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    graphDbBaseUrl = parsed.url;
  }
  const repositoryId = buildRepositoryId(body.domain, body.displayName, user.username);
  const graphIri = buildGraphIri(body.domain, body.displayName, user.username);

  await createRepository({
    repositoryId,
    label: body.displayName,
    graphDbBaseUrl,
  });
  await createNamedGraph({
    repositoryId,
    graphIri,
    graphDbBaseUrl,
  });

  const target = await db.knowledgeGraphTarget.create({
    data: {
      userId: user.id,
      domain: body.domain,
      repositoryId,
      graphIri,
      displayName: body.displayName,
    },
    select: {
      id: true,
      userId: true,
      domain: true,
      repositoryId: true,
      graphIri: true,
      displayName: true,
    },
  });

  return NextResponse.json({ target }, { status: 201 });
}
