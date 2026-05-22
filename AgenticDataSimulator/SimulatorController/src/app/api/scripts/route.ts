import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import {
  createScriptForUser,
  listScriptsForUser,
} from "@/lib/scripts/repository";

const createScriptBodySchema = z.object({
  domain: z.string().trim().min(1),
  name: z.string().trim().min(1),
  content: z.string().default(""),
  lastRunMode: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain") ?? undefined;
  const scripts = await listScriptsForUser(user.id, domain);

  return NextResponse.json({ scripts });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = createScriptBodySchema.parse(await request.json());
  const script = await createScriptForUser({
    userId: user.id,
    domain: body.domain,
    name: body.name,
    content: body.content,
    lastRunMode: body.lastRunMode,
  });

  return NextResponse.json({ script }, { status: 201 });
}
