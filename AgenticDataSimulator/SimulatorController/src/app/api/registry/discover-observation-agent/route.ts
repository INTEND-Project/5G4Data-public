import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { listRegistryRecords } from "@/lib/registry/client";
import { pickObservationControlAgent } from "@/lib/registry/observation-agent-discovery";

const bodySchema = z.object({
  domain: z.string().min(1),
  preferredAgentName: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const records = await listRegistryRecords({ forceRefresh: false });
  const match = pickObservationControlAgent(records, parsed.data.domain, {
    preferredAgentName: parsed.data.preferredAgentName,
  });

  if (!match) {
    return NextResponse.json(
      {
        error: `No observation-control agent found for domain "${parsed.data.domain}" in the registry.`,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ agent: match });
}
