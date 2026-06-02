import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { getPrometheusConnectionStatus } from "@/lib/prometheus/status";
import { parsePrometheusBaseUrlInput } from "@/lib/prometheus/resolve-base-url";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prometheusBaseUrlParam = new URL(request.url).searchParams.get("prometheusBaseUrl")?.trim();
  let prometheusBaseUrl: string | undefined;
  if (prometheusBaseUrlParam) {
    const parsed = parsePrometheusBaseUrlInput(prometheusBaseUrlParam);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    prometheusBaseUrl = parsed.url;
  }

  const connected = await getPrometheusConnectionStatus(prometheusBaseUrl);
  return NextResponse.json({ connected });
}
