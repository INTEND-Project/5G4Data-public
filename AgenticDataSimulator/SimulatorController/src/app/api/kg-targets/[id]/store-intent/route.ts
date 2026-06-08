import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { ingestIntentTurtle } from "@/lib/graphdb/client";
import { storePrometheusMetadataForIntent } from "@/lib/kg/store-prometheus-metadata";
import { extractIntentLocalIdFromTurtle } from "@/lib/intent/extract-intent-turtle";
import { normalizeIntentTurtleOnIngest } from "@/lib/intent/normalize-intent-turtle-on-ingest";
import { parseStorageFromIntentTurtle } from "@/lib/intents/resolve-intent-storage";
import { registerUserIntent } from "@/lib/intents/user-intent-registry";
import { parsePrometheusBaseUrlInput } from "@/lib/prometheus/resolve-base-url";
import { parseGraphDbBaseUrlInput } from "@/lib/graphdb/resolve-base-url";

const bodySchema = z.object({
  turtle: z.string().min(1),
  storage: z.enum(["graphdb", "prometheus"]).optional(),
  prometheusBaseUrl: z.string().trim().optional(),
  graphDbBaseUrl: z.string().trim().optional(),
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
      domain: true,
      repositoryId: true,
      graphIri: true,
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Knowledge graph target not found" }, { status: 404 });
  }

  let prometheusBaseUrl: string | undefined;
  if (body.prometheusBaseUrl?.trim()) {
    const parsed = parsePrometheusBaseUrlInput(body.prometheusBaseUrl);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    prometheusBaseUrl = parsed.url;
  }

  let graphDbBaseUrl: string | undefined;
  if (body.graphDbBaseUrl?.trim()) {
    const parsed = parseGraphDbBaseUrlInput(body.graphDbBaseUrl);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    graphDbBaseUrl = parsed.url;
  }

  const turtle = normalizeIntentTurtleOnIngest(body.turtle);

  try {
    await ingestIntentTurtle({
      repositoryId: target.repositoryId,
      graphIri: target.graphIri,
      turtle,
      graphDbBaseUrl,
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

  const intentId = extractIntentLocalIdFromTurtle(turtle);
  const storage = body.storage ?? parseStorageFromIntentTurtle(turtle) ?? "graphdb";

  if (intentId) {
    await registerUserIntent({
      userId: user.id,
      domain: target.domain,
      intentId,
      storage,
      graphTargetId: target.id,
    });
  }

  let metadataResult: { stored: number; failed: number } | null = null;
  if (intentId && storage === "prometheus") {
    try {
      metadataResult = await storePrometheusMetadataForIntent({
        repositoryId: target.repositoryId,
        graphIri: target.graphIri,
        intentId,
        prometheusBaseUrl,
        graphDbBaseUrl,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Prometheus metadata registration failed";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  return NextResponse.json({
    ok: true,
    intentId: intentId ?? null,
    graphTargetId: target.id,
    storage,
    prometheusMetadata: metadataResult,
  });
}
