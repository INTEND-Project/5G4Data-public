import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { analyzeScript } from "@/lib/dsl/analysis/analyze-script";

const dryRunBodySchema = z.object({
  script: z.string(),
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = dryRunBodySchema.parse(await request.json());
  const analysis = analyzeScript(body.script);

  return NextResponse.json({
    mode: "dry-run",
    statements: analysis.statements,
    diagnostics: analysis.diagnostics,
  });
}
