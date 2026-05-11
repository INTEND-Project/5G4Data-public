import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { analyzeScript } from "@/lib/dsl/analysis/analyze-script";

const executeBodySchema = z.object({
  scriptId: z.string().min(1),
  graphTargetId: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = executeBodySchema.parse(await request.json());
  const script = await db.script.findFirst({
    where: {
      id: body.scriptId,
      userId: user.id,
    },
  });

  if (!script) {
    return NextResponse.json({ error: "Script not found" }, { status: 404 });
  }

  const graphTarget = await db.knowledgeGraphTarget.findFirst({
    where: {
      id: body.graphTargetId,
      userId: user.id,
    },
  });

  if (!graphTarget) {
    return NextResponse.json({ error: "Knowledge graph target not found" }, { status: 404 });
  }

  const analysis = analyzeScript(script.content);
  const status = analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? "failed"
    : "completed";

  const run = await db.scriptRun.create({
    data: {
      scriptId: script.id,
      userId: user.id,
      domain: script.domain,
      mode: "execute",
      status,
      graphTargetId: graphTarget.id,
      diagnosticsJson: analysis.diagnostics,
      executionLogJson: {
        executedStatements: analysis.statements.length,
        selectedGraphTargetId: graphTarget.id,
      },
      finishedAt: new Date(),
    },
    select: {
      id: true,
      scriptId: true,
      userId: true,
      domain: true,
      mode: true,
      status: true,
      graphTargetId: true,
    },
  });

  return NextResponse.json({
    run,
    orchestration: {
      executedStatements: analysis.statements.length,
      selectedGraphTargetId: graphTarget.id,
    },
    diagnostics: analysis.diagnostics,
  });
}
