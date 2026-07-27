import { NextResponse } from "next/server";

import { enrichAgentsWithDiscoveryRole } from "@/lib/registry/enrich-agents";
import { listNormalizedAgents, listRegistryRecords } from "@/lib/registry/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");
  const refresh = searchParams.get("refresh");
  const forceRefresh = refresh === "1" || refresh === "true";
  const agents = await listNormalizedAgents(
    forceRefresh ? { forceRefresh: true } : undefined,
  );
  const records = await listRegistryRecords(
    forceRefresh ? { forceRefresh: true } : undefined,
  );
  const enriched = enrichAgentsWithDiscoveryRole(records, agents);

  return NextResponse.json({
    agents: domain ? enriched.filter((agent) => agent.domain === domain) : enriched,
  });
}
