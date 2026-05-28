import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { createRunLog, listRunLogsForUser } from "@/lib/run-logs/repository";

const createRunLogBodySchema = z.object({
  domain: z.string().trim().min(1),
  scriptName: z.string().trim().min(1),
  scriptId: z.string().min(1).optional(),
  mode: z.enum(["dry-run", "execute"]),
  lines: z.array(z.string()),
  startedAt: z.string().datetime(),
});

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain")?.trim();

  if (!domain) {
    return NextResponse.json({ error: "domain query parameter is required" }, { status: 400 });
  }

  const runLogs = await listRunLogsForUser(user.id, domain);

  return NextResponse.json({
    runLogs: runLogs.map((run) => ({
      id: run.id,
      scriptName: run.scriptName,
      scriptId: run.scriptId,
      mode: run.mode,
      lines: run.lines,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = createRunLogBodySchema.parse(await request.json());
  const runLog = await createRunLog({
    userId: user.id,
    domain: body.domain,
    scriptName: body.scriptName,
    scriptId: body.scriptId,
    mode: body.mode,
    lines: body.lines,
    startedAt: new Date(body.startedAt),
  });

  return NextResponse.json(
    {
      runLog: {
        id: runLog.id,
        scriptName: runLog.scriptName,
        scriptId: runLog.scriptId,
        mode: runLog.mode,
        lines: runLog.lines,
        startedAt: runLog.startedAt.toISOString(),
        finishedAt: runLog.finishedAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
