import type { DslStatement, ObservationStorageType } from "@/lib/dsl/types";
import { DEFAULT_OBSERVATION_STORAGE, parseObservationStorageType } from "@/lib/observation-storage";

const discoverIntentWorkspacePattern = /^discover intent-agent for domain as ([^\s]+)$/;
const discoverPattern =
  /^discover (intent-agent|status-agent|observation-agent) by domain ([^\s]+) as ([^\s]+)$/;
const createIntentPattern =
  /^create intent using ([^\s]+)(?: storage (graphdb|prometheus))? prompt "([\s\S]+)" as ([^\s]+)$/;
const extractMetricCatalogPattern =
  /^extract metric-catalog for ([^\s]+) as ([^\s]+)$/;
const requestStatusPattern =
  /^request status-report using ([^\s]+) for ([^\s]+) instructions "([\s\S]+)" as ([^\s]+)$/;
const requestObservationPattern =
  /^request observation-report using ([^\s]+) for ([^\s]+)(?: storage (graphdb|prometheus))? instructions "([\s\S]+)" as ([^\s]+)$/;

export function parseScript(script: string): { statements: DslStatement[] } {
  const statements: DslStatement[] = [];

  for (const [index, rawLine] of script.split("\n").entries()) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const discoverIntentWorkspaceMatch = line.match(discoverIntentWorkspacePattern);

    if (discoverIntentWorkspaceMatch) {
      statements.push({
        kind: "discover-intent-workspace-domain",
        line: index + 1,
        alias: discoverIntentWorkspaceMatch[1],
      });
      continue;
    }

    const discoverMatch = line.match(discoverPattern);

    if (discoverMatch) {
      statements.push({
        kind: "discover",
        line: index + 1,
        agentKind: discoverMatch[1] as DslStatement["kind"] extends never
          ? never
          : "intent-agent" | "status-agent" | "observation-agent",
        domain: discoverMatch[2],
        alias: discoverMatch[3],
      });
      continue;
    }

    const createIntentMatch = line.match(createIntentPattern);

    if (createIntentMatch) {
      const storageRaw = createIntentMatch[2];
      const storage: ObservationStorageType =
        parseObservationStorageType(storageRaw) ?? DEFAULT_OBSERVATION_STORAGE;
      statements.push({
        kind: "create-intent",
        line: index + 1,
        agentAlias: createIntentMatch[1],
        storage,
        prompt: createIntentMatch[3],
        intentAlias: createIntentMatch[4],
      });
      continue;
    }

    const extractMetricCatalogMatch = line.match(extractMetricCatalogPattern);

    if (extractMetricCatalogMatch) {
      statements.push({
        kind: "extract-metric-catalog",
        line: index + 1,
        intentAlias: extractMetricCatalogMatch[1],
        metricCatalogAlias: extractMetricCatalogMatch[2],
      });
      continue;
    }

    const requestStatusMatch = line.match(requestStatusPattern);

    if (requestStatusMatch) {
      statements.push({
        kind: "request-status-report",
        line: index + 1,
        agentAlias: requestStatusMatch[1],
        intentAlias: requestStatusMatch[2],
        instructions: requestStatusMatch[3],
        sessionAlias: requestStatusMatch[4],
      });
      continue;
    }

    const requestObservationMatch = line.match(requestObservationPattern);

    if (requestObservationMatch) {
      const storageOverride = parseObservationStorageType(requestObservationMatch[3]);
      statements.push({
        kind: "request-observation-report",
        line: index + 1,
        agentAlias: requestObservationMatch[1],
        intentAlias: requestObservationMatch[2],
        storage: storageOverride,
        instructions: requestObservationMatch[4],
        sessionAlias: requestObservationMatch[5],
      });
    }
  }

  return { statements };
}
