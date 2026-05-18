import type { DslDiagnostic, DslStatement } from "@/lib/dsl/types";
import { parseCanonicalIntentLocalId } from "@/lib/intent/extract-intent-turtle";

export function validateScript(statements: DslStatement[]): DslDiagnostic[] {
  const diagnostics: DslDiagnostic[] = [];
  const agentAliases = new Set<string>();
  const intentAliases = new Set<string>();
  const workspaceIntentDiscoverLines = new Set<number>();

  for (const statement of statements) {
    switch (statement.kind) {
      case "discover-intent-workspace-domain":
        agentAliases.add(statement.alias);
        workspaceIntentDiscoverLines.add(statement.line);
        break;
      case "discover":
        agentAliases.add(statement.alias);
        break;
      case "create-intent":
        if (statement.agentAlias === "intentGen") {
          const precededWorkspace = [...workspaceIntentDiscoverLines].some(
            (ln) => ln < statement.line,
          );
          const legacyIntentGen = agentAliases.has("intentGen");
          if (!precededWorkspace && !legacyIntentGen) {
            diagnostics.push({
              line: statement.line,
              severity: "error",
              code: "UNKNOWN_AGENT_ALIAS",
              message:
                'Unknown agent alias "intentGen". Add `discover intent-agent for domain as <alias>` before this line, or discover intent-agent … as intentGen.',
            });
          }
        } else if (!agentAliases.has(statement.agentAlias)) {
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
        if (
          !intentAliases.has(statement.intentAlias) &&
          !parseCanonicalIntentLocalId(statement.intentAlias)
        ) {
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

        if (
          !intentAliases.has(statement.intentAlias) &&
          !parseCanonicalIntentLocalId(statement.intentAlias)
        ) {
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
