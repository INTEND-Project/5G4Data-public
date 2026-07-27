import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import {
  buildSharedScriptName,
  sharedNameSuffixFromInput,
} from "@/lib/scripts/shared-name";
import {
  createScriptForUser,
  listVisibleScripts,
} from "@/lib/scripts/repository";

const createScriptBodySchema = z.object({
  domain: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  nameSuffix: z.string().trim().optional(),
  content: z.string().default(""),
  shared: z.boolean().optional(),
  lastRunMode: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain") ?? undefined;
  const scripts = await listVisibleScripts(user.id, domain);

  return NextResponse.json({ scripts });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = createScriptBodySchema.parse(await request.json());

  let name = body.name?.trim() ?? "";

  if (body.shared) {
    const suffix = sharedNameSuffixFromInput(body);
    if (!suffix) {
      return NextResponse.json(
        { error: "Shared scripts require a non-empty name suffix after shared-." },
        { status: 400 },
      );
    }
    name = buildSharedScriptName(suffix);
  } else if (!name) {
    return NextResponse.json({ error: "Script name is required." }, { status: 400 });
  }

  const script = await createScriptForUser({
    userId: user.id,
    domain: body.domain,
    name,
    content: body.content,
    shared: body.shared ?? false,
    lastRunMode: body.lastRunMode,
  });

  return NextResponse.json({ script }, { status: 201 });
}
