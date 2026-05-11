import type { DslDiagnostic, DslStatement } from "@/lib/dsl/types";

export function validateScript(statements: DslStatement[]): DslDiagnostic[] {
  const diagnostics: DslDiagnostic[] = [];
  const agentAliases = new Set<string>();
  const intentAliases = new Set<string>();

  for (const statement of statements) {
    switch (statement.kind) {
      case "discover":
        agentAliases.add(statement.alias);
        break;
      case "create-intent":
        if (!agentAliases.has(statement.agentAlias)) {
          diagnostics.push({
            line: statement.line,
            severity: "error",
            code: "UNKNOWN_AGENT_ALIAS",
            message: `Unknown agent alias "${statement.agentAlias}".`,
          });
        }
        intentAliases.add(statement.intentAlias);
        break;
      case "extract-metric-catalog":
        if (!intentAliases.has(statement.intentAlias)) {
          diagnostics.push({
            line: statement.line,
            severity: "error",
            code: "UNKNOWN_INTENT_ALIAS",
            message: `Unknown intent alias "${statement.intentAlias}".`,
          });
        }
        break;
      case "request-status-report":
      case "request-observation-report":
        if (!agentAliases.has(statement.agentAlias)) {
          diagnostics.push({
            line: statement.line,
            severity: "error",
            code: "UNKNOWN_AGENT_ALIAS",
            message: `Unknown agent alias "${statement.agentAlias}".`,
          });
        }

        if (!intentAliases.has(statement.intentAlias)) {
          diagnostics.push({
            line: statement.line,
            severity: "error",
            code: "UNKNOWN_INTENT_ALIAS",
            message: `Unknown intent alias "${statement.intentAlias}".`,
          });
        }
        break;
    }
  }

  return diagnostics;
}
