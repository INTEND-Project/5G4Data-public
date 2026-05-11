import { NextResponse } from "next/server";
import { z } from "zod";

import { buildCompletionContext } from "@/lib/dsl/analysis/build-completion-context";

const completionsBodySchema = z.object({
  script: z.string(),
  extractedMetricCatalogs: z.record(z.string(), z.array(z.string())),
});

export async function POST(request: Request) {
  const body = completionsBodySchema.parse(await request.json());
  const context = buildCompletionContext(body);

  return NextResponse.json(context);
}
