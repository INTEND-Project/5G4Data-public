import { parseScript } from "@/lib/dsl/parser/parse-script";
import { validateScript } from "@/lib/dsl/validator/validate-script";

export function analyzeScript(script: string) {
  const parsed = parseScript(script);
  const diagnostics = validateScript(parsed.statements);

  return {
    statements: parsed.statements,
    diagnostics,
  };
}
