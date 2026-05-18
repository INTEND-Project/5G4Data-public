import type { SyntheticMode } from "./syntheticPrompt.js";

function envStr(k: string, fallback: string): string {
  const v = process.env[k]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function synthApiKey(): string | undefined {
  const raw = process.env.SYNTH_OBS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const t = raw?.trim();
  return t && t.length > 0 ? t : undefined;
}

export interface SyntheticCodegenContextSlice {
  fullUserPrompt: string;
  intentId: string;
  compoundMetric: string;
  kgUnitResolved: string;
  instructionsSlice: string;
  mode: SyntheticMode;
  frequencySeconds: number;
  historicBounds?: {
    startIso: string;
    endIso: string;
  };
  timezoneHint?: string;
}

const SYSTEM_PROMPT = `You are a codegen assistant for deterministic synthetic telemetry.
Output strict JSON ONLY on a single line: {"snippet":"..."}.
The snippet must be a JavaScript FUNCTION BODY (not a whole function declaration) assigned nothing.
Given a synthetic context variable \`ctx\`, it must EXECUTE imperative statements and MUST end with returning a NUMBER (IEEE double) — the sampled observation magnitude.

ALLOWED identifiers: Math, Number, Date, ctx (the only injected variable).

ctx fields:
- ctx.simTime: Date (UTC for simulations)
- ctx.tickIndex: nonnegative integer sequence index starting at 0
- ctx.mode: "streaming" | "historic"
- ctx.metric: compound metric local name ..._CO...
- ctx.intentId: local intent identifier
- ctx.frequencySeconds: integer step duration in seconds between logical samples
- ctx.uniform01(): deterministic uniform (0,1] PRNG seeded by harness
- ctx.unitHint: RDF unit label string (informational only)

RULES:
- Respect requested ranges/window wording as closely as reproducible deterministic code permits.
- No async, no awaits, no external libraries, no filesystem or network references.
- No comments outside // single-line sparingly OK.
- Produce stable behavior for the same inputs (prefer ctx.uniform01 branching).`;

/** Parse model JSON envelope; supports fenced markdown or trailing noise. */
export function envelopeSnippet(contentRaw: string): string | null {
  let content = contentRaw.trim();
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)```$/miu);
  if (fenced?.[1]) content = fenced[1].trim();
  try {
    const j = JSON.parse(content) as { snippet?: string };
    if (typeof j.snippet === "string" && j.snippet.trim()) return j.snippet.trim();
  } catch {
    /* fall through */
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(content.slice(start, end + 1)) as { snippet?: string };
      if (typeof j.snippet === "string" && j.snippet.trim()) return j.snippet.trim();
    } catch {
      return null;
    }
  }
  return null;
}

export async function codegenMetricSnippet(
  slice: SyntheticCodegenContextSlice
): Promise<{ ok: true; snippet: string } | { ok: false; error: string }> {
  const apiKey = synthApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: "Missing SYNTH_OBS_OPENAI_API_KEY or OPENAI_API_KEY for synthetic codegen."
    };
  }
  const base = envStr("SYNTH_OBS_OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  const model = envStr("SYNTH_OBS_MODEL", "gpt-4o-mini");

  const userPayload = JSON.stringify(slice, null, 2);

  const url = `${base}/chat/completions`;
  const body = {
    model,
    temperature: 0.15,
    max_tokens: 1200,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Synthesize deterministic observation sample logic.\n### Context JSON\n${userPayload}\n### Output\nReturn JSON only.`
      }
    ]
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: `LLM codegen HTTP ${res.status}: ${errText.slice(0, 512)}` };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) return { ok: false, error: "Empty completion from model." };
    const snippet = envelopeSnippet(content);
    if (!snippet) return { ok: false, error: "Could not parse snippet JSON from model output." };

    return { ok: true, snippet };
  } catch (e) {
    return { ok: false, error: `Codegen request failed: ${String(e)}` };
  }
}
