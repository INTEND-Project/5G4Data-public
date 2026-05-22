import { parseScript } from "@/lib/dsl/parser/parse-script";

type CompletionContextInput = {
  script: string;
  extractedMetricCatalogs: Record<string, string[]>;
};

type CompletionContext = {
  stage: "discovery" | "reporting";
  metricNames: string[];
};

export function buildCompletionContext(
  input: CompletionContextInput,
): CompletionContext {
  const parsed = parseScript(input.script);
  const metricNames = Array.from(
    new Set(Object.values(input.extractedMetricCatalogs).flat()),
  );
  const stage = parsed.statements.some(
    (statement) =>
      statement.kind === "request-status-report" ||
      statement.kind === "request-observation-report",
  )
    ? "reporting"
    : "discovery";

  return {
    stage,
    metricNames,
  };
}
