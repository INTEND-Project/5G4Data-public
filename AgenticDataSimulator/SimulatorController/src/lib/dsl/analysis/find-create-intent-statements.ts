import { analyzeScript } from "@/lib/dsl/analysis/analyze-script";
import type { CreateIntentStatement } from "@/lib/dsl/types";

export type CreateIntentCandidate = {
  line: number;
  prompt: string;
  intentAlias: string;
  agentAlias: string;
};

export function findCreateIntentStatements(script: string): CreateIntentCandidate[] {
  const { statements } = analyzeScript(script);
  return statements
    .filter((statement): statement is CreateIntentStatement => statement.kind === "create-intent")
    .map((statement) => ({
      line: statement.line,
      prompt: statement.prompt,
      intentAlias: statement.intentAlias,
      agentAlias: statement.agentAlias,
    }));
}
