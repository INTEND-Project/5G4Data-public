import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntheticMode } from "./syntheticPrompt.js";
import { buildValidatedFallbackSnippet } from "./syntheticSnippetFallback.js";
import {
  assertPowerEnergySemantics,
  inferSamplingKind,
  resolveCodegenModuleNames,
  type SamplingKind,
  validateSnippetSamples
} from "./syntheticSnippetProbe.js";
import { validateGeneratedSnippet } from "./syntheticSnippetValidate.js";

const MAX_CODEGEN_ATTEMPTS = 4;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const promptModulesDir = join(packageRoot, "prompt_modules");

const moduleCache = new Map<string, string>();

function loadPromptModule(stem: string): string {
  let cached = moduleCache.get(stem);
  if (cached === undefined) {
    cached = readFileSync(join(promptModulesDir, `${stem}.md`), "utf8").trim();
    moduleCache.set(stem, cached);
  }
  return cached;
}

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
  samplingKind?: SamplingKind;
  appendedModules?: string[];
  /** Intent-derived baseline span when instructions omit an explicit numeric range. */
  baselineMin?: number;
  baselineMax?: number;
}

/** True when user instructions already specify a numeric value span. */
export function instructionsIncludeExplicitNumericRange(text?: string): boolean {
  if (!text?.trim()) return false;
  return (
    /\b\d+(?:\.\d+)?\s*(?:-|to)\s*\d+(?:\.\d+)?\b/u.test(text) ||
    /\bbetween\s+\d+(?:\.\d+)?/iu.test(text) ||
    /\brange\s+(?:is\s+)?(?:between\s+)?\d+/iu.test(text)
  );
}

const CODEGEN_CORE_PROMPT = `You are a codegen assistant for deterministic synthetic telemetry.
Output strict JSON ONLY on a single line: {"snippet":"..."}.
The snippet must be a JavaScript FUNCTION BODY (not a whole function declaration) assigned nothing.
Given a synthetic context variable \`ctx\`, it must EXECUTE imperative statements and MUST end with returning a NUMBER (IEEE double) — the sampled observation magnitude.

ALLOWED identifiers: Math, Number, Date, ctx (the only injected variable).

RULES:
- Respect requested ranges and clock windows from the context JSON as closely as reproducible deterministic code permits.
- When instructions omit an explicit numeric range and context includes baselineMin/baselineMax, sample within that baseline span.
- When instructions mention daytime, business hours, morning/evening, or clock times without explicit UTC, use ctx.localHour (not ctx.simTime.getUTCHours()) unless timezoneHint is absent and UTC is clearly intended.
- Do NOT return literal 0 for off-hours/night unless instructions explicitly request zero or unavailable service. When a numeric range is given (e.g. 500-2000), use the low end or a reduced baseline off-hours instead of zero.
- In historic mode, each tick's ctx.simTime advances through historicBounds; return one sample for the current tick.
- Default sampling kind is per-tick gauge unless a cumulative_codegen module is appended.
- Appended ### … codegen sections are authoritative for sampling semantics. When gauge_codegen is present, do NOT use cumulative loops over ctx.tickIndex even if tickIndex is large or mode is historic.
- No async, no awaits, no external libraries, no filesystem or network references.
- No comments outside // single-line sparingly OK.
- Produce stable behavior for the same inputs (prefer ctx.uniform01 branching).`;

function buildCtxApiAppendix(samplingKind: SamplingKind): string {
  const common = `ctx fields:
- ctx.simTime: Date (UTC instant for each simulated sample)
- ctx.tickIndex: nonnegative integer sequence index starting at 0
- ctx.mode: "streaming" | "historic"
- ctx.metric: compound metric local name ..._CO...
- ctx.intentId: local intent identifier
- ctx.frequencySeconds: integer step duration in seconds between logical samples
- ctx.uniform01(): deterministic uniform (0,1] PRNG seeded by harness
- ctx.unitHint: RDF unit label string (informational only)
- ctx.utcOffsetMinutes: integer offset east of UTC from optional timezoneHint (0 when absent)
- ctx.localHour: hour-of-day 0–23 after applying utcOffsetMinutes to ctx.simTime
- ctx.tickInDay: day index since historic start (floor(tickIndex * frequencySeconds / 86400))
- ctx.tickInHour: tick slot within the current local hour (0 = top of hour); use for stress-window dip offsets`;

  if (samplingKind === "counter") {
    return `${common}
- ctx.uniformForStep(stepIndex): deterministic uniform (0,1] keyed by stepIndex; use inside the cumulative loop for per-step increments (stable when tickIndex increases)

Counter sampling: ctx.tickIndex drives a running total; loop i=1..ctx.tickIndex summing positive increments with ctx.uniformForStep(i).`;
  }

  return `${common}
- ctx.uniformForStep(stepIndex): deterministic uniform (0,1] keyed by integer stepIndex; use only as directed by appended modules (e.g. dip episode scheduling), not for summing history

Gauge sampling: return the current reading only. ctx.tickIndex is NOT a loop bound. Do not sum past ticks. For stress dips, schedule episodes with ctx.tickInHour inside the stress hour, not global ctx.tickIndex.`;
}

const MODULE_HEADERS: Record<string, string> = {
  gauge_codegen: "### Gauge per-tick sampling codegen",
  stress_dip_codegen: "### Stress-period dip episodes codegen",
  cumulative_codegen: "### Cumulative counter codegen"
};

/** System prompt for codegen; composes core, ctx appendix, and prompt_modules by instruction classifiers. */
export function buildCodegenSystemPrompt(
  instructionsSlice?: string,
  compoundMetric?: string
): string {
  const samplingKind = inferSamplingKind(instructionsSlice, compoundMetric);
  const moduleNames = resolveCodegenModuleNames(instructionsSlice, compoundMetric);

  const parts = [CODEGEN_CORE_PROMPT, buildCtxApiAppendix(samplingKind)];

  for (const name of moduleNames) {
    const header = MODULE_HEADERS[name] ?? `### ${name}`;
    parts.push(`${header}\n${loadPromptModule(name)}`);
  }

  return parts.join("\n\n");
}

/** Build enriched context payload for the LLM user message. */
export function enrichCodegenContextSlice(slice: SyntheticCodegenContextSlice): SyntheticCodegenContextSlice {
  return {
    ...slice,
    samplingKind: inferSamplingKind(slice.instructionsSlice, slice.compoundMetric),
    appendedModules: resolveCodegenModuleNames(slice.instructionsSlice, slice.compoundMetric)
  };
}

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

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** User message for a failed validation retry — sampling-kind aware. */
export function buildCodegenRetryMessage(
  reason: string,
  slice: SyntheticCodegenContextSlice,
): string {
  const kind = inferSamplingKind(slice.instructionsSlice, slice.compoundMetric);

  if (kind === "counter") {
    if (/decreases between tick/iu.test(reason)) {
      return (
        `Validation failed: ${reason}\n` +
        "Fix: cumulative counter only. Use let total = baseline; for (let i = 1; i <= ctx.tickIndex; i++) { total += positiveIncrement * (0.9 + 0.2 * ctx.uniformForStep(i)); } return total. " +
        "Never use ctx.uniform01() inside the accumulation loop or baseline + ctx.tickIndex * increment * ctx.uniform01(). Return JSON only."
      );
    }
    return (
      `Validation failed: ${reason}\n` +
      "Fix per cumulative_codegen: running total with a loop over i=1..ctx.tickIndex and ctx.uniformForStep(i) for per-step variation. Return JSON only."
    );
  }

  if (/stress-window dip/iu.test(reason)) {
    const threshold = reason.match(/below (\d+)/u)?.[1] ?? "350";
    return (
      `Validation failed: ${reason}\n` +
      "Fix per stress_dip_codegen: schedule two dip episodes per stress hour using ctx.tickInHour (not global ctx.tickIndex). " +
      `During dips return values below ${threshold}. Return JSON only.`
    );
  }

  return (
    `Validation failed: ${reason}\n` +
    "Fix the snippet per appended gauge_codegen / stress_dip_codegen modules. Return one per-tick gauge sample for the current tick. Return JSON only."
  );
}

function validateCodegenSnippet(
  snippet: string,
  slice: SyntheticCodegenContextSlice
): { ok: true } | { ok: false; reason: string } {
  const staticCheck = validateGeneratedSnippet(snippet);
  if (!staticCheck.ok) return staticCheck;

  const semanticsCheck = assertPowerEnergySemantics(slice.compoundMetric, slice.instructionsSlice);
  if (!semanticsCheck.ok) return semanticsCheck;

  return validateSnippetSamples({
    snippet,
    intentId: slice.intentId,
    compoundMetric: slice.compoundMetric,
    mode: slice.mode,
    frequencySeconds: slice.frequencySeconds,
    historicStartIso: slice.historicBounds?.startIso,
    historicEndIso: slice.historicBounds?.endIso,
    timezoneHint: slice.timezoneHint,
    unitHint: slice.kgUnitResolved,
    instructionsSlice: slice.instructionsSlice
  });
}

async function requestSnippetFromLlm(
  apiKey: string,
  base: string,
  model: string,
  messages: ChatMessage[]
): Promise<{ ok: true; snippet: string } | { ok: false; error: string }> {
  const url = `${base}/chat/completions`;
  const body = {
    model,
    temperature: 0.15,
    max_tokens: 1200,
    messages
  };

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

  const enriched = enrichCodegenContextSlice(slice);
  const userPayload = JSON.stringify(enriched, null, 2);
  const systemContent = buildCodegenSystemPrompt(slice.instructionsSlice, slice.compoundMetric);

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content:
        `Synthesize deterministic observation sample logic.\n### Context JSON\n${userPayload}\n### Output\nReturn JSON only.`
    }
  ];

  try {
    const samplingKind = inferSamplingKind(slice.instructionsSlice, slice.compoundMetric);
    if (samplingKind === "counter") {
      const fastFallback = buildValidatedFallbackSnippet(slice);
      if (fastFallback.ok) {
        process.stderr.write(
          `[synthetic] Using validated fallback for cumulative metric ${slice.compoundMetric}.\n`,
        );
        return { ok: true, snippet: fastFallback.snippet };
      }
    }

    let lastReason = "Codegen validation failed.";

    for (let attempt = 0; attempt < MAX_CODEGEN_ATTEMPTS; attempt += 1) {
      const completion = await requestSnippetFromLlm(apiKey, base, model, messages);
      if (!completion.ok) return completion;

      const validation = validateCodegenSnippet(completion.snippet, slice);
      if (validation.ok) {
        return { ok: true, snippet: completion.snippet };
      }

      lastReason = validation.reason;
      messages.push({ role: "assistant", content: JSON.stringify({ snippet: completion.snippet }) });
      messages.push({
        role: "user",
        content: buildCodegenRetryMessage(validation.reason, slice),
      });
    }

    const fallback = buildValidatedFallbackSnippet(slice);
    if (fallback.ok) {
      process.stderr.write(
        `[synthetic] LLM codegen failed for ${slice.compoundMetric}; using validated fallback snippet.\n`,
      );
      return { ok: true, snippet: fallback.snippet };
    }

    return { ok: false, error: lastReason };
  } catch (e) {
    return { ok: false, error: `Codegen request failed: ${String(e)}` };
  }
}
