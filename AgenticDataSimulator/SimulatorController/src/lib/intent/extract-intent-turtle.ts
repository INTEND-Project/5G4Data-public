const FENCED_TURTLE = /```(?:turtle|ttl)\s*([\s\S]*?)```/gi;

/** Heuristic aligned with TurnOrchestrator output: RDF prefixes plus intent-ish shape. */
function looksLikeIntentTurtle(turtle: string): boolean {
  const s = turtle.trim();
  if (!s.includes("@prefix")) {
    return false;
  }
  return (
    /icm:Intent\b/.test(s) ||
    /imo:Intent\b/.test(s) ||
    /data5g:I[a-f0-9]{32}\b/i.test(s)
  );
}

function stripLeadingFence(text: string): string {
  return text.trim().replace(/^\uFEFF/, "");
}

function stripShaclValidationComments(text: string): string {
  const marker = "\n# SHACL validation result";
  const idx = text.indexOf(marker);
  return idx >= 0 ? text.slice(0, idx).trimEnd() : text;
}

/** LLMs sometimes close the markdown fence before trailing Turtle subject blocks. */
function appendTrailingTurtleFragments(fencedChunk: string, visibleText: string): string {
  const lastFence = visibleText.lastIndexOf("```");
  if (lastFence < 0) {
    return fencedChunk;
  }
  const trailing = stripShaclValidationComments(visibleText.slice(lastFence + 3).trim());
  if (!trailing || !/^(@prefix|data5g:)/m.test(trailing)) {
    return fencedChunk;
  }
  return `${fencedChunk.trimEnd()}\n\n${trailing}`;
}

/**
 * Parses {@link visibleText} from an A2A agent turn into Turtle suitable for GraphDB ingestion.
 * Handles ```turtle fenced blocks embedded in conversational markdown.
 */
export function extractIntentTurtle(visibleText: string): string | null {
  if (!visibleText?.trim()) {
    return null;
  }

  FENCED_TURTLE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIntentChunk: string | null = null;
  while ((match = FENCED_TURTLE.exec(visibleText)) !== null) {
    const chunk = appendTrailingTurtleFragments(
      stripShaclValidationComments(stripLeadingFence(match[1] ?? "")),
      visibleText,
    );
    if (looksLikeIntentTurtle(chunk)) {
      lastIntentChunk = chunk;
    }
  }
  if (lastIntentChunk) {
    return lastIntentChunk;
  }

  const whole = stripShaclValidationComments(stripLeadingFence(visibleText));
  if (looksLikeIntentTurtle(whole)) {
    return whole;
  }

  return null;
}

/** Match Python graphdb_client intent uuid suffix only (32 hex after `data5g:I`). */
export function extractIntentUuidSuffixFromTurtle(turtle: string): string | null {
  const m = turtle.match(/\bdata5g:I([a-f0-9]{32})\b/i);
  return m?.[1] ?? null;
}

/**
 * Full intent local id (`I` + 32 hex), matching CURIE form `data5g:Ie4d6…` in Turtle payloads.
 */
export function extractIntentLocalIdFromTurtle(turtle: string): string | null {
  const suffix = extractIntentUuidSuffixFromTurtle(turtle);
  return suffix ? `I${suffix}` : null;
}

/** Normalizes store-intent API `intentId` to `I` + 32 hex (accepts legacy bare uuid). */
export function normalizedIntentIdFromStoreResponse(
  id: string | undefined | null,
): string | null {
  if (typeof id !== "string") {
    return null;
  }
  const t = id.trim();
  if (t.length === 0) {
    return null;
  }
  const hex = t.replace(/^I/i, "");
  if (/^[a-f0-9]{32}$/i.test(hex)) {
    return `I${hex}`;
  }
  return t;
}

/** Canonical intent local id (`I` + 32 hex) when `for` in DSL references an intent directly. */
export function parseCanonicalIntentLocalId(raw: string): string | null {
  const normalized = normalizedIntentIdFromStoreResponse(raw.trim());
  return normalized && /^I[a-f0-9]{32}$/i.test(normalized) ? normalized : null;
}
