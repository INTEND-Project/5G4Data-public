import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import {
  deleteScriptForUser,
  getScriptForUser,
  updateScriptForUser,
} from "@/lib/scripts/repository";

const updateScriptBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    content: z.string().optional(),
    lastRunMode: z.string().nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.content !== undefined ||
      value.lastRunMode !== undefined,
    { message: "At least one field must be updated." },
  );

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const script = await getScriptForUser(user.id, id);

  if (!script) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ script });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existingScript = await getScriptForUser(user.id, id);

  if (!existingScript) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = updateScriptBodySchema.parse(await request.json());
  const script = await updateScriptForUser(id, body);

  return NextResponse.json({ script });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existingScript = await getScriptForUser(user.id, id);

  if (!existingScript) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteScriptForUser(id);

  return NextResponse.json({ ok: true });
}
