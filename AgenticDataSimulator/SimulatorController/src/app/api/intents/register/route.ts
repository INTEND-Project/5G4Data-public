import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { registerUserIntent } from "@/lib/intents/user-intent-registry";
import { parsePrometheusBaseUrlInput } from "@/lib/prometheus/resolve-base-url";

const registerBodySchema = z.object({
  domain: z.string().trim().min(1),
  intentId: z.string().trim().min(1),
  storage: z.enum(["graphdb", "prometheus"]).optional(),
  graphTargetId: z.string().min(1).optional(),
  prometheusBaseUrl: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = registerBodySchema.parse(await request.json());

  if (body.prometheusBaseUrl?.trim()) {
    const parsed = parsePrometheusBaseUrlInput(body.prometheusBaseUrl);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
  }

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
