import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { parsePrometheusBaseUrlFromSearchParams } from "@/lib/prometheus/parse-request-base-url";
import { listIntentIds } from "@/lib/prometheus/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedUrl = parsePrometheusBaseUrlFromSearchParams(new URL(request.url).searchParams);
  if (!parsedUrl.ok) {
    return NextResponse.json({ error: parsedUrl.error }, { status: 400 });
  }

  try {
    const intentIds = await listIntentIds(parsedUrl.url);
    return NextResponse.json({ intentIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prometheus intent discovery failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
