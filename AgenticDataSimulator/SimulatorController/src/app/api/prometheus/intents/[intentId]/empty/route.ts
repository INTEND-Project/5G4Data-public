import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { assertUserOwnsIntent } from "@/lib/intents/user-intent-registry";
import { parsePrometheusBaseUrlFromSearchParams } from "@/lib/prometheus/parse-request-base-url";
import { clearIntentMetrics, validateIntentIdForPrometheusClear } from "@/lib/prometheus/client";

type RouteContext = {
  params: Promise<{
    intentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
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

  const ownsIntent = await assertUserOwnsIntent(user.id, intentId);
  if (!ownsIntent) {
    return NextResponse.json({ error: "Intent not found" }, { status: 404 });
  }

  const parsedUrl = parsePrometheusBaseUrlFromSearchParams(new URL(request.url).searchParams);
  if (!parsedUrl.ok) {
    return NextResponse.json({ error: parsedUrl.error }, { status: 400 });
  }

  try {
    const result = await clearIntentMetrics(intentId, {
      prometheusBaseUrl: parsedUrl.url,
    });
    return NextResponse.json({ clearedIntentId: result.intentId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prometheus intent clear failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
