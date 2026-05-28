import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { registerUserIntent } from "@/lib/intents/user-intent-registry";

const registerBodySchema = z.object({
  domain: z.string().trim().min(1),
  intentId: z.string().trim().min(1),
  storage: z.enum(["graphdb", "prometheus"]).optional(),
  graphTargetId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = registerBodySchema.parse(await request.json());

  try {
    await registerUserIntent({
      userId: user.id,
      domain: body.domain,
      intentId: body.intentId,
      storage: body.storage,
      graphTargetId: body.graphTargetId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intent registration failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, intentId: body.intentId });
}
