import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { getGraphDbConnectionStatus } from "@/lib/graphdb/status";
import { parseGraphDbBaseUrlInput } from "@/lib/graphdb/resolve-base-url";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const graphDbBaseUrlParam = new URL(request.url).searchParams.get("graphDbBaseUrl")?.trim();
  let graphDbBaseUrl: string | undefined;
  if (graphDbBaseUrlParam) {
    const parsed = parseGraphDbBaseUrlInput(graphDbBaseUrlParam);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    graphDbBaseUrl = parsed.url;
  }

  const connected = await getGraphDbConnectionStatus(graphDbBaseUrl);
  return NextResponse.json({ connected });
}
