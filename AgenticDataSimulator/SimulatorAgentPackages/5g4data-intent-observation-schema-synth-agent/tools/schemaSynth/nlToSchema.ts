import { constraintJsonSchemaText } from "./schema/jsonSchema.js";
import { CONSTRAINT_DOCUMENT_MAPPING_SYSTEM } from "./mappingSystemPrompt.js";
import {
  type ConstraintDocument,
  parseConstraintDocument,
  safeParseConstraintDocument
} from "./schema/types.js";
import {
  dslDateToIso,
  extractInstructionGlobals,
  type InstructionGlobals
} from "./parseGlobals.js";

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

type LlmProvider = "openai" | "anthropic";

export type NlToSchemaOptions = {
  allowHeuristic?: boolean;
  /** Session / Studio override (takes precedence over env). */
  provider?: LlmProvider;
  model?: string;
};

function openaiApiKey(): string | undefined {
  const k =
    process.env.SYNTH_OBS_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  return k && k.length > 0 ? k : undefined;
}

function anthropicApiKey(): string | undefined {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k && k.length > 0 ? k : undefined;
}

/**
 * Prefer SCHEMA_SYNTH_* (experiment parity), then LLM_PROVIDER, then key availability.
 * Do not pick OpenAI merely because OPENAI_API_KEY is set when Anthropic is configured.
 */
function resolveProvider(options?: NlToSchemaOptions): LlmProvider {
  if (options?.provider === "anthropic" || options?.provider === "openai") {
    return options.provider;
  }
  const explicit = env("SCHEMA_SYNTH_PROVIDER").toLowerCase();
  if (explicit === "anthropic" || explicit === "openai") {
    return explicit;
  }
  const modelName = (options?.model?.trim() || env("SCHEMA_SYNTH_MODEL")).toLowerCase();
  if (modelName.startsWith("claude")) {
    return "anthropic";
  }
  const chatProvider = env("LLM_PROVIDER").toLowerCase();
  if (chatProvider === "anthropic" || chatProvider === "openai") {
    return chatProvider;
  }
  if (anthropicApiKey() && !openaiApiKey()) {
    return "anthropic";
  }
  if (openaiApiKey() && !anthropicApiKey()) {
    return "openai";
  }
  if (anthropicApiKey()) {
    return "anthropic";
  }
  if (openaiApiKey()) {
    return "openai";
  }
  return "openai";
}

function model(provider: LlmProvider, options?: NlToSchemaOptions): string {
  const override = options?.model?.trim();
  if (override) return override;
  const configured = env("SCHEMA_SYNTH_MODEL");
  if (configured) return configured;
  if (provider === "anthropic") {
    return env("ANTHROPIC_MODEL", "claude-sonnet-4-5");
  }
  return env("OPENAI_MODEL", "gpt-4o");
}

function openaiBaseUrl(): string {
  return env("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
}

function anthropicMessagesUrl(): string {
  let base = env("ANTHROPIC_BASE_URL", "https://api.anthropic.com").replace(/\/$/, "");
  if (base.endsWith("/v1")) {
    base = base.slice(0, -3);
  }
  return `${base}/v1/messages`;
}

function hasLlmCredentials(): boolean {
  return Boolean(openaiApiKey() || anthropicApiKey());
}

function buildSeedDocument(globals: InstructionGlobals): Partial<ConstraintDocument> {
  const metrics =
    globals.metrics.length > 0
      ? globals.metrics.map((name) => ({ name }))
      : [{ name: "metric" }];
  const mode = globals.mode ?? "historic";
  const timeline: ConstraintDocument["timeline"] = {
    mode,
    frequencySeconds: globals.frequencySeconds ?? 60,
    ...(mode === "streaming"
      ? {
          start: globals.start ? dslDateToIso(globals.start) : undefined,
          stop: globals.stop ? dslDateToIso(globals.stop) : undefined
        }
      : {
          start: globals.start ? dslDateToIso(globals.start) : "2026-05-21T05:00:00Z",
          stop: globals.stop ? dslDateToIso(globals.stop) : "2026-05-22T05:00:00Z"
        })
  };
  return {
    version: 1,
    samplingKind: "gauge",
    timeline,
    metrics,
    recurringWindows: [],
    episodes: [],
    absoluteOverrides: [],
    noise: "low"
  };
}

async function chatJsonOpenAi(
  messages: Array<{ role: string; content: string }>,
  options?: NlToSchemaOptions
): Promise<string> {
  const key = openaiApiKey();
  if (!key) {
    throw new Error(
      "Missing OPENAI_API_KEY (or SYNTH_OBS_OPENAI_API_KEY). Set it or rely on the heuristic mapper."
    );
  }
  const res = await fetch(`${openaiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model("openai", options),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages
    })
  });
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI returned empty content");
  return content;
}

async function chatJsonAnthropic(
  messages: Array<{ role: string; content: string }>,
  options?: NlToSchemaOptions
): Promise<string> {
  const key = anthropicApiKey();
  if (!key) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Set it or rely on the heuristic mapper."
    );
  }
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const conversation = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const res = await fetch(anthropicMessagesUrl(), {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model("anthropic", options),
      max_tokens: 4096,
      temperature: 0.2,
      system: system || undefined,
      messages: conversation
    })
  });
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const body = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content =
    body.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim() ?? "";
  if (!content) throw new Error("Anthropic returned empty content");
  return content;
}

async function chatJson(
  messages: Array<{ role: string; content: string }>,
  options?: NlToSchemaOptions
): Promise<string> {
  const provider = resolveProvider(options);
  if (provider === "anthropic") {
    return chatJsonAnthropic(messages, options);
  }
  return chatJsonOpenAi(messages, options);
}

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  return JSON.parse(cleaned);
}

function mergeGlobals(
  doc: ConstraintDocument,
  globals: InstructionGlobals
): ConstraintDocument {
  const next = { ...doc, timeline: { ...doc.timeline } };
  if (globals.mode) next.timeline.mode = globals.mode;
  if (globals.start) next.timeline.start = dslDateToIso(globals.start);
  if (globals.stop) next.timeline.stop = dslDateToIso(globals.stop);
  if (globals.frequencySeconds) next.timeline.frequencySeconds = globals.frequencySeconds;
  if (globals.metrics.length > 0) {
    next.metrics = globals.metrics.map((name) => {
      const existing = doc.metrics.find((m) => m.name === name);
      return existing ?? { name };
    });
  }
  return next;
}

/** Heuristic offline mapper used when no API key (and for tests). */
export function heuristicNlToSchema(instructions: string): ConstraintDocument {
  const globals = extractInstructionGlobals(instructions);
  const seed = buildSeedDocument(globals);
  const text = instructions.toLowerCase();

  const samplingKind = /cumulative|monoton|running.?total|counter|start at\s+\d/.test(text)
    ? "counter"
    : "gauge";

  const bands: Array<{ min: number; max: number }> = [];
  const betweenRe =
    /(?:between|range(?:\s+is)?(?:\s+between)?)\s+(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = betweenRe.exec(instructions)) !== null) {
    bands.push({ min: Number(m[1]), max: Number(m[2]) });
  }
  const keepRe = /keep\s+(?:values\s+)?(?:in\s+)?(?:the\s+)?(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/gi;
  while ((m = keepRe.exec(instructions)) !== null) {
    bands.push({ min: Number(m[1]), max: Number(m[2]) });
  }

  const defaultBand = bands[0] ?? { min: 0, max: 100 };
  const recurringWindows: ConstraintDocument["recurringWindows"] = [];
  const clockRe =
    /(?:between|during)\s+(\d{1,2}):(\d{2})\s*(?:-|–|and)\s*(\d{1,2}):(\d{2})[^.]{0,80}?(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/gi;
  while ((m = clockRe.exec(instructions)) !== null) {
    recurringWindows.push({
      startHour: Number(m[1]),
      endHour: Number(m[3]),
      band: { min: Number(m[5]), max: Number(m[6]) },
      noise: /low noise/i.test(instructions) ? "low" : undefined,
      dailyVariation: /daily variation/i.test(instructions)
    });
  }

  // Daytime pattern without explicit band capture above
  if (recurringWindows.length === 0 && /06:00|6:00/.test(instructions) && bands.length >= 2) {
    recurringWindows.push({
      startHour: 6,
      endHour: 18,
      band: bands[1],
      noise: "low",
      dailyVariation: /daily variation/i.test(instructions)
    });
  }

  const episodes: ConstraintDocument["episodes"] = [];
  const stressHours: Array<{ startHour: number; endHour: number }> = [];
  const stressRe = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
  if (/stress|congestion|dip|spike|burst|batch|scarcity|compaction|maintenance/i.test(instructions)) {
    let sm: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((sm = stressRe.exec(instructions)) !== null) {
      const startHour = Number(sm[1]);
      const endHour = Number(sm[3]);
      // Skip broad daytime 06-18 style windows already captured as recurring
      if (startHour === 6 && endHour === 18) continue;
      if (endHour - startHour > 6) continue;
      const key = `${startHour}-${endHour}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stressHours.push({ startHour, endHour });
    }
  }
  const dipBand =
    bands.find((b) => b.max <= (defaultBand.min + defaultBand.max) / 2) ??
    bands[bands.length - 1] ??
    defaultBand;
  if (stressHours.length > 0 && /dip|spike|burst|congestion|batch|stress/i.test(text)) {
    const type = /spike|burst|congestion/.test(text) && !/dip/.test(text) ? "spike" : "dip";
    const dur = instructions.match(/(\d+)\s*-\s*(\d+)\s*min/i);
    episodes.push({
      type,
      windows: stressHours.slice(0, 4),
      band: dipBand,
      durationMinutes: {
        min: dur ? Number(dur[1]) : 3,
        max: dur ? Number(dur[2]) : 10
      },
      countPerWindow: {
        atLeast: /at least two|≥\s*2|at least 2/i.test(instructions) ? 2 : 1
      }
    });
  }

  const absoluteOverrides: ConstraintDocument["absoluteOverrides"] = [];
  const abs =
    instructions.match(
      /Between\s+(\d{4}-\d{2}-\d{2}T[^\s]+)\s+and\s+(\d{4}-\d{2}-\d{2}T[^\s]+)[^.]{0,60}?(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/i
    );
  if (abs) {
    absoluteOverrides.push({
      start: abs[1],
      stop: abs[2],
      band: { min: Number(abs[3]), max: Number(abs[4]) }
    });
  }

  let counter: ConstraintDocument["counter"] | undefined;
  if (samplingKind === "counter") {
    const startAt = Number(instructions.match(/start(?:ing)? at\s+(\d+(?:\.\d+)?)/i)?.[1] ?? 100);
    const inc = instructions.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*joules?/i);
    counter = {
      startAt,
      increment: inc ? { min: Number(inc[1]), max: Number(inc[2]) } : { min: 5, max: 15 }
    };
  }

  let level: ConstraintDocument["level"];
  let seasonality: ConstraintDocument["seasonality"];
  let residual: ConstraintDocument["residual"];
  let shocks: ConstraintDocument["shocks"];

  if (/ar\(1\)|ar1|seasonal|fourier|mean-reverting|ornstein|ou\b|heavy-tailed|shocks/i.test(text)) {
    const meanMatch = instructions.match(/mean around\s+(\d+(?:\.\d+)?)/i)
      || instructions.match(/around\s+(\d+(?:\.\d+)?)\s*Mbps/i)
      || instructions.match(/near\s+(\d+(?:\.\d+)?)/i);
    level = { mean: meanMatch ? Number(meanMatch[1]) : (defaultBand.min + defaultBand.max) / 2 };
    if (/seasonal|fourier|24-hour|diurnal/i.test(text)) {
      const amp = Number(instructions.match(/plus or minus\s+(\d+(?:\.\d+)?)/i)?.[1]
        ?? instructions.match(/amplitude about\s+(\d+(?:\.\d+)?)/i)?.[1]
        ?? 10);
      seasonality = {
        periodHours: 24,
        amplitude: amp,
        phaseHours: /mid-afternoon/i.test(text) ? 15 : 6
      };
    }
    if (/ar\(1\)|ar1|mean-reverting|ornstein|ou\b/i.test(text)) {
      residual = { type: "ar1", sigma: Math.max(1, (defaultBand.max - defaultBand.min) * 0.05), phi: 0.85 };
    } else if (/white noise|light noise/i.test(text)) {
      residual = { type: "white", sigma: Math.max(1, (defaultBand.max - defaultBand.min) * 0.03) };
    }
    if (/shock/i.test(text)) {
      const rate = Number(instructions.match(/(\d+)\s*-\s*(\d+)\s*heavy/i)?.[2] ?? 4);
      shocks = { ratePerDay: rate, scale: Math.max(10, (defaultBand.max - defaultBand.min) * 0.3), distribution: "student_t", df: 3 };
    }
  }

  const doc = parseConstraintDocument({
    ...seed,
    samplingKind,
    defaultBand,
    recurringWindows,
    episodes,
    absoluteOverrides,
    noise: /high noise/i.test(text) ? "high" : "low",
    counter,
    level,
    seasonality,
    residual,
    shocks,
    seed: 42
  });
  return mergeGlobals(doc, globals);
}

export async function nlToConstraintDocument(
  instructions: string,
  options?: NlToSchemaOptions
): Promise<{ document: ConstraintDocument; source: "llm" | "heuristic" }> {
  const globals = extractInstructionGlobals(instructions);
  const allowHeuristic = options?.allowHeuristic !== false;

  if (!hasLlmCredentials()) {
    if (!allowHeuristic) {
      throw new Error("OPENAI_API_KEY or ANTHROPIC_API_KEY required");
    }
    return { document: heuristicNlToSchema(instructions), source: "heuristic" };
  }

  const schemaText = constraintJsonSchemaText();
  const seed = buildSeedDocument(globals);
  const user = JSON.stringify(
    {
      globals,
      prose: globals.prose,
      seedTimelineAndMetrics: seed,
      jsonSchema: schemaText
    },
    null,
    2
  );

  let content = await chatJson(
    [
      { role: "system", content: CONSTRAINT_DOCUMENT_MAPPING_SYSTEM },
      { role: "user", content: user }
    ],
    options
  );

  let parsed = extractJsonObject(content);
  let result = safeParseConstraintDocument(parsed);
  if (!result.success) {
    content = await chatJson(
      [
        { role: "system", content: CONSTRAINT_DOCUMENT_MAPPING_SYSTEM },
        { role: "user", content: user },
        { role: "assistant", content },
        {
          role: "user",
          content: `Validation errors: ${JSON.stringify(result.error.issues)}. Return corrected JSON only.`
        }
      ],
      options
    );
    parsed = extractJsonObject(content);
    result = safeParseConstraintDocument(parsed);
    if (!result.success) {
      if (allowHeuristic) {
        return { document: heuristicNlToSchema(instructions), source: "heuristic" };
      }
      throw new Error(`Constraint schema invalid after repair: ${result.error.message}`);
    }
  }

  return { document: mergeGlobals(result.data, globals), source: "llm" };
}
