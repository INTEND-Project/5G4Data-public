import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { getInfraConnectionStatus } from "@/lib/infra/connection-status";
import { parsePrometheusBaseUrlFromSearchParams } from "@/lib/prometheus/parse-request-base-url";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedUrl = parsePrometheusBaseUrlFromSearchParams(new URL(request.url).searchParams);
  if (!parsedUrl.ok) {
    return NextResponse.json({ error: parsedUrl.error }, { status: 400 });
  }

  const status = await getInfraConnectionStatus({
    forceRefresh: true,
    prometheusBaseUrl: parsedUrl.url,
  });
  return NextResponse.json(status);
}
