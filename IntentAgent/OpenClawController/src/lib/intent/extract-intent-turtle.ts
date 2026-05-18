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
  while ((match = FENCED_TURTLE.exec(visibleText)) !== null) {
    const chunk = stripLeadingFence(match[1] ?? "");
    if (looksLikeIntentTurtle(chunk)) {
      return chunk;
    }
  }

  const whole = stripLeadingFence(visibleText);
  if (looksLikeIntentTurtle(whole)) {
    return whole;
  }

  return null;
}

/** Match Python graphdb_client intent id extraction (`data5g:I` + 32 hex). */
export function extractIntentUuidSuffixFromTurtle(turtle: string): string | null {
  const m = turtle.match(/\bdata5g:I([a-f0-9]{32})\b/i);
  return m?.[1] ?? null;
}
