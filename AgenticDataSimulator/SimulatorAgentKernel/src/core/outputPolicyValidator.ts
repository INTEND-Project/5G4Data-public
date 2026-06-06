import { Parser } from "n3";
import type { ValidatorRules } from "./packageLoader.js";
import type { IntentFlags } from "./workflowEngine.js";

function isUuid4Hex(hex: string): boolean {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return false;
  const versionNibble = hex[12]?.toLowerCase();
  const variantNibble = hex[16]?.toLowerCase();
  return versionNibble === "4" && ["8", "9", "a", "b"].includes(variantNibble ?? "");
}

function collectInvalidUuid4LocalNames(text: string): string[] {
  const invalid: string[] = [];
  const seen = new Set<string>();
  const pattern = /\bdata5g:(I|CO|CX|DE|NE|RE|RG)([A-Za-z0-9_-]+)\b/g;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    const full = `data5g:${match[1]}${match[2]}`;
    const suffix = match[2] ?? "";
    if (!/^[0-9a-fA-F]{32}$/.test(suffix) || !isUuid4Hex(suffix)) {
      if (!seen.has(full)) {
        invalid.push(full);
        seen.add(full);
      }
    }
    match = pattern.exec(text);
  }
  return invalid;
}

function collectRegexRuleViolations(
  text: string,
  identifierRules: ValidatorRules["identifierRules"]
): string[] {
  if (!identifierRules || identifierRules.length === 0) return [];
  const issues: string[] = [];
  for (const rule of identifierRules) {
    const pattern = new RegExp(rule.regex, "g");
    const invalid: string[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match) {
      const candidate = match[0];
      const suffix = (match[2] ?? "").trim();
      const uuidViolation = rule.validateAsUuid4Suffix ? !isUuid4Hex(suffix) : false;
      if (uuidViolation && !seen.has(candidate)) {
        invalid.push(candidate);
        seen.add(candidate);
      }
      match = pattern.exec(text);
    }
    if (invalid.length > 0) {
      issues.push(`${rule.error} Invalid: ${invalid.slice(0, 8).join(", ")}`);
    }
  }
  return issues;
}


export function looksLikeTurtleIntent(text: string): boolean {
  return text.includes("@prefix") && (text.includes("icm:Intent") || text.includes("imo:Intent"));
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:turtle|ttl)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function stripShaclValidationComments(text: string): string {
  const marker = "\n# SHACL validation result";
  const idx = text.indexOf(marker);
  return idx >= 0 ? text.slice(0, idx).trimEnd() : text;
}

function stripLeadingNarration(text: string): string {
  const prefixMatch = text.match(/@prefix\s+\S+/);
  if (!prefixMatch || prefixMatch.index === undefined || prefixMatch.index === 0) {
    return text;
  }
  return text.slice(prefixMatch.index).trimStart();
}

function looksLikeNarrationLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("#")) return false;
  if (/^@prefix\b|^@base\b/.test(trimmed)) return false;
  if (
    /data5g:|icm:|imo:|log:|set:|quan:|ut:|fun:|mf:|time:|geo:|rdfs:|rdf:|dct:/.test(line)
  ) {
    return false;
  }
  if (/^[\[\](){}.;,\s]+$/.test(trimmed)) return false;
  if (/^\.\s*$/.test(trimmed)) return false;
  if (/^\s+[a-zA-Z]+:/.test(line)) return false;
  return (
    /^(?:here['’]s|here is|below is|the following is|this is|note:|summary:)/i.test(trimmed) ||
    /^[A-Za-z"']/.test(trimmed)
  );
}

function stripInterleavedNarration(text: string): string {
  const lines = text.split("\n");
  const filtered = lines.filter((line) => !looksLikeNarrationLine(line));
  let end = filtered.length;
  while (end > 0 && (filtered[end - 1]?.trim() ?? "") === "") {
    end -= 1;
  }
  while (end > 0 && looksLikeNarrationLine(filtered[end - 1] ?? "")) {
    end -= 1;
  }
  return filtered.slice(0, end).join("\n");
}

export function extractTurtlePayload(text: string): string {
  const withoutFence = stripShaclValidationComments(stripMarkdownFence(text)).trim();
  const fromPrefix = stripLeadingNarration(withoutFence);
  return stripInterleavedNarration(fromPrefix).trimEnd();
}

function turtlePayloadForValidation(text: string): string {
  if (!text.includes("@prefix")) return text;
  const extracted = extractTurtlePayload(text);
  return looksLikeTurtleIntent(extracted) ? extracted : text;
}

function collectTurtleSyntaxIssues(text: string): string[] {
  if (!looksLikeTurtleIntent(text)) return [];
  try {
    const parser = new Parser({ format: "text/turtle" });
    parser.parse(text);
    return [];
  } catch (error) {
    return [`Turtle syntax is invalid and must be repaired: ${String(error)}`];
  }
}

export function collectOutputIssues(args: {
  text: string;
  intentFlags: IntentFlags;
  runtimeContext: string;
  validatorRules: ValidatorRules;
}): string[] {
  const { text, runtimeContext, validatorRules, intentFlags } = args;
  const issues: string[] = [];
  const lowered = text.toLowerCase();
  const runtimeLowered = runtimeContext.toLowerCase();
  const hasForbiddenPhrase = validatorRules.forbiddenPhrases.some((phrase) =>
    lowered.includes(phrase.toLowerCase())
  );
  if (hasForbiddenPhrase) {
    issues.push("Contains narration/progress text or placeholder markers.");
  }

  const turtleLike = text.includes("@prefix");
  const turtleText = turtleLike ? turtlePayloadForValidation(text) : text;
  if (turtleLike) {
    if (
      validatorRules.clarificationTag &&
      runtimeLowered.includes(validatorRules.clarificationTag.toLowerCase())
    ) {
      issues.push(
        "Deployment without geolocation hint requires a clarification question before generating Turtle."
      );
    }
    const missing = validatorRules.requiredTokens.filter((token) => !turtleText.includes(token));
    if (missing.length > 0) {
      issues.push(`Missing required classes/blocks: ${missing.join(", ")}`);
    }
    for (const requirement of validatorRules.conditionalRequirements) {
      if (!intentFlags[requirement.intentFlag]) continue;
      const present = requirement.requiresAnyTokens.some((token) => turtleText.includes(token));
      if (!present) {
        issues.push(requirement.error);
      }
    }
    const configuredIdentifierIssues = collectRegexRuleViolations(
      turtleText,
      validatorRules.identifierRules
    );
    issues.push(...configuredIdentifierIssues);
    if (!validatorRules.identifierRules || validatorRules.identifierRules.length === 0) {
      const invalidIds = collectInvalidUuid4LocalNames(turtleText);
      if (invalidIds.length > 0) {
        issues.push(
          `Identifier local names must be UUIDv4-derived (32 hex, version=4, variant=8|9|a|b). Invalid: ${invalidIds.slice(0, 8).join(", ")}`
        );
      }
    }
    issues.push(...collectTurtleSyntaxIssues(turtleText));
    if (intentFlags.deployment || intentFlags.sustainability) {
      if (!runtimeLowered.includes("[selected workload objectives]")) {
        issues.push(
          "Deployment/sustainability requested but runtime context has no [selected workload objectives] from the catalogue.",
        );
      }
    }
  }

  if (lowered.includes("please provide the following details")) {
    issues.push("Asked for details that should be auto-filled by defaults policy.");
  }
  if (lowered.includes("please provide") && lowered.includes("handler")) {
    issues.push("Asked user for handler though handler is fixed.");
  }
  if (lowered.includes("please provide") && lowered.includes("owner")) {
    issues.push("Asked user for owner though owner is fixed.");
  }
  return issues;
}
