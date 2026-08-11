export type FewShotMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ParsedModelfilePrompt = {
  systemPrompt: string;
  fewShotMessages: FewShotMessage[];
  isModelfile: boolean;
};

function looksLikeModelfile(raw: string): boolean {
  return /^\s*(SYSTEM|MESSAGE|PARAMETER)\b/m.test(raw);
}

function extractQuotedOrBareValue(
  text: string,
  startIndex: number
): { value: string; endIndex: number } | null {
  let i = startIndex;
  while (i < text.length && /[ \t]/.test(text[i]!)) i += 1;
  if (i >= text.length) return null;

  if (text.startsWith('"""', i)) {
    const close = text.indexOf('"""', i + 3);
    if (close < 0) {
      return { value: text.slice(i + 3), endIndex: text.length };
    }
    return { value: text.slice(i + 3, close), endIndex: close + 3 };
  }

  const lineEnd = text.indexOf("\n", i);
  const end = lineEnd < 0 ? text.length : lineEnd;
  return { value: text.slice(i, end).trim(), endIndex: end };
}

/** Parse Ollama Modelfile SYSTEM/MESSAGE text, or return plain text as system prompt. */
export function parseModelfileOrSystemPrompt(raw: string): ParsedModelfilePrompt {
  const text = typeof raw === "string" ? raw : "";
  if (!looksLikeModelfile(text)) {
    return { systemPrompt: text.trim(), fewShotMessages: [], isModelfile: false };
  }

  let systemPrompt = "";
  const fewShotMessages: FewShotMessage[] = [];
  const directiveRe = /^\s*(SYSTEM|MESSAGE|PARAMETER)\b/gim;
  let match: RegExpExecArray | null;
  const hits: Array<{ kind: string; index: number; endKeyword: number }> = [];
  while ((match = directiveRe.exec(text)) !== null) {
    hits.push({
      kind: match[1]!.toUpperCase(),
      index: match.index,
      endKeyword: match.index + match[0].length
    });
  }

  for (let h = 0; h < hits.length; h += 1) {
    const hit = hits[h]!;
    const nextStart = h + 1 < hits.length ? hits[h + 1]!.index : text.length;
    const segment = text.slice(hit.endKeyword, nextStart);

    if (hit.kind === "SYSTEM") {
      const extracted = extractQuotedOrBareValue(text, hit.endKeyword);
      if (extracted) systemPrompt = extracted.value.trim();
      continue;
    }

    if (hit.kind === "MESSAGE") {
      const roleMatch = segment.match(/^\s*(user|assistant)\b/i);
      if (!roleMatch) continue;
      const role = roleMatch[1]!.toLowerCase() as "user" | "assistant";
      const afterRole = hit.endKeyword + (roleMatch.index ?? 0) + roleMatch[0].length;
      const extracted = extractQuotedOrBareValue(text, afterRole);
      if (!extracted) continue;
      const content = extracted.value.trim();
      if (content) fewShotMessages.push({ role, content });
    }
  }

  return {
    systemPrompt: systemPrompt || text.trim(),
    fewShotMessages,
    isModelfile: true
  };
}
