import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeScript } from "@/lib/dsl/analysis/analyze-script";

const analyzeBodySchema = z.object({
  script: z.string(),
});

export async function POST(request: Request) {
  const body = analyzeBodySchema.parse(await request.json());
  const analysis = analyzeScript(body.script);

  return NextResponse.json(analysis);
}
