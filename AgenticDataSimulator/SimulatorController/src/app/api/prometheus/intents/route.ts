import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { listIntentIds } from "@/lib/prometheus/client";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const intentIds = await listIntentIds();
    return NextResponse.json({ intentIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prometheus intent discovery failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
