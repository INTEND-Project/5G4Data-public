import { NextResponse } from "next/server";

import { listNormalizedAgents } from "@/lib/registry/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");
  const refresh = searchParams.get("refresh");
  const agents = await listNormalizedAgents(
    refresh === "1" || refresh === "true" ? { forceRefresh: true } : undefined,
  );

  return NextResponse.json({
    agents: domain ? agents.filter((agent) => agent.domain === domain) : agents,
  });
}
