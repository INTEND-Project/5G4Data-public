import { NextResponse } from "next/server";

import { listNormalizedAgents } from "@/lib/registry/client";
import { deriveDomains } from "@/lib/registry/normalize";

export async function GET() {
  const agents = await listNormalizedAgents();
  const domains = deriveDomains(agents);

  return NextResponse.json({ domains });
}
