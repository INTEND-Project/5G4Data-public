import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { parseGraphDbBaseUrlInput } from "@/lib/graphdb/resolve-base-url";
import { EXTRA_FUNCTIONAL_TOOL_IDS } from "@/lib/tools/extra-functional-tools";
import {
  PrepareIntentError,
  prepareIntentForTool,
} from "@/lib/tools/prepare-intent-for-tool";
import { parseTmfBaseUrlInput } from "@/lib/tools/parse-tmf-base-url";
import { sendTmf921Intent } from "@/lib/tools/send-tmf921-intent";

const bodySchema = z.object({
  toolId: z.enum(EXTRA_FUNCTIONAL_TOOL_IDS),
  tmfBaseUrl: z.string().min(1),
  kgTargetId: z.string().min(1),
  intentId: z.string().min(1),
  graphDbBaseUrl: z.string().optional(),
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const tmfParsed = parseTmfBaseUrlInput(body.tmfBaseUrl);
  if (!tmfParsed.ok) {
    return NextResponse.json({ error: tmfParsed.error }, { status: 400 });
  }

  if (body.graphDbBaseUrl?.trim()) {
    const graphParsed = parseGraphDbBaseUrlInput(body.graphDbBaseUrl);
    if (!graphParsed.ok) {
      return NextResponse.json({ error: graphParsed.error }, { status: 400 });
    }
  }

  try {
    const prepared = await prepareIntentForTool({
      userId: user.id,
      kgTargetId: body.kgTargetId,
      intentId: body.intentId,
      toolId: body.toolId,
      graphDbBaseUrl: body.graphDbBaseUrl,
    });

    const result = await sendTmf921Intent(tmfParsed.url, prepared.payload);

    return NextResponse.json({
      intentId: prepared.intentId,
      toolId: prepared.toolId,
      status: result.status,
      body: result.body,
      targetUrl: result.targetUrl,
    });
  } catch (error) {
    if (error instanceof PrepareIntentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to send intent to tool";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
