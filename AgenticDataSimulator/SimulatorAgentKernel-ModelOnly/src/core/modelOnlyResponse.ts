import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ShaclValidationResult } from "./shaclValidatorTool.js";
import { looksLikeTurtleIntent } from "./outputPolicyValidator.js";

const FALLBACK_PREFIXES = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .
@prefix mf: <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

/** ModelOnly: accept intent Turtle even when the model omits @prefix lines. */
export function looksLikeModelOnlyTurtle(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeTurtleIntent(t)) return true;
  const hasIntent = t.includes("icm:Intent") || /\bdata5g:I[0-9a-fA-F]{32}\b/.test(t);
  const hasTurtleSignals =
    t.includes("data5g:") || t.includes("imo:handler") || t.includes("log:allOf");
  return hasIntent && hasTurtleSignals;
}

export function ensureTurtlePrefixes(text: string, packageDir?: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("@prefix")) return trimmed;
  let prefixes = FALLBACK_PREFIXES.trim();
  if (packageDir) {
    const candidate = join(packageDir, "templates", "canonical-prefixes.ttl");
    if (existsSync(candidate)) {
      prefixes = readFileSync(candidate, "utf8").trim();
    }
  }
  return `${prefixes}\n\n${trimmed}`;
}

export function formatShaclSection(
  label: string,
  result: ShaclValidationResult | null,
  skippedReason?: string
): string {
  if (skippedReason || !result) {
    return [
      `### ${label}`,
      `conforms: skipped`,
      skippedReason ?? "SHACL validation skipped."
    ].join("\n");
  }
  const body =
    result.violations.length === 0
      ? result.reportText || "Conforms."
      : result.reportText ||
        result.violations
          .map((v, i) => {
            const focus = v.focusNode ? ` focus=${v.focusNode}` : "";
            const path = v.path ? ` path=${v.path}` : "";
            return `${i + 1}. ${v.message}${focus}${path}`;
          })
          .join("\n");
  return [`### ${label}`, `conforms: ${result.conforms}`, body].join("\n");
}

export function formatModelOnlyResponse(args: {
  turtleOrText: string;
  isTurtle: boolean;
  tioResult: ShaclValidationResult | null;
  data5gResult: ShaclValidationResult | null;
  skipReason?: string;
}): string {
  if (!args.isTurtle) {
    return [
      args.turtleOrText.trim(),
      "",
      "---",
      "## SHACL validation",
      "",
      formatShaclSection("TIO", null, args.skipReason ?? "Output is not Turtle; SHACL skipped."),
      "",
      formatShaclSection("5g4data", null, args.skipReason ?? "Output is not Turtle; SHACL skipped.")
    ].join("\n");
  }

  return [
    args.turtleOrText.trim(),
    "",
    "---",
    "## SHACL validation",
    "",
    formatShaclSection("TIO", args.tioResult),
    "",
    formatShaclSection("5g4data", args.data5gResult)
  ].join("\n");
}
