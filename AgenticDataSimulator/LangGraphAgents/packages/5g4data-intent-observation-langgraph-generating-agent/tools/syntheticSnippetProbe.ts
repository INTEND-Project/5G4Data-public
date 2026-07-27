import type { SyntheticMode } from "./syntheticPrompt.js";
import { compileSnippet, type SnippetCtx, uniformForStepRng } from "./syntheticMetricWorker.js";
import {
  hashSeed,
  localHourFromSim,
  mulberry32,
  parseUtcOffsetMinutes,
  tickInDayFromTickIndex,
  tickInHourFromSim
} from "./syntheticPrng.js";

export interface SnippetProbeArgs {
  snippet: string;
  intentId: string;
  compoundMetric: string;
  mode: SyntheticMode;
  frequencySeconds: number;
  historicStartIso?: string;
  historicEndIso?: string;
  timezoneHint?: string;
  unitHint?: string;
  maxSamples?: number;
}

function prngForTick(
  intentId: string,
  compoundMetric: string,
  mode: SyntheticMode,
  tickIndex: number,
  wallMs?: number
): () => number {
  const wallPart = mode === "streaming" && wallMs !== undefined ? `|${wallMs}` : "";
  return mulberry32(hashSeed(`${intentId}|${compoundMetric}|${mode}|${tickIndex}${wallPart}`));
}

function buildCtx(args: SnippetProbeArgs, simTime: Date, tickIndex: number, wallMs?: number): SnippetCtx {
  const utcOffsetMinutes = parseUtcOffsetMinutes(args.timezoneHint);
  return {
    simTime,
    tickIndex,
    mode: args.mode,
    metric: args.compoundMetric,
    intentId: args.intentId,
    frequencySeconds: args.frequencySeconds,
    uniform01: prngForTick(args.intentId, args.compoundMetric, args.mode, tickIndex, wallMs),
    uniformForStep: (stepIndex: number) =>
      uniformForStepRng(args.intentId, args.compoundMetric, args.mode, stepIndex),
    unitHint: args.unitHint ?? "NA",
    utcOffsetMinutes,
    localHour: localHourFromSim(simTime, utcOffsetMinutes),
    tickInDay: tickInDayFromTickIndex(tickIndex, args.frequencySeconds),
    tickInHour: tickInHourFromSim(simTime, args.frequencySeconds, utcOffsetMinutes)
  };
}

function historicSampleTimes(
  startIso: string,
  endIso: string,
  frequencySeconds: number,
  maxSamples: number
): Array<{ simTime: Date; tickIndex: number }> {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return [];
  }

  const freqMs = Math.max(1, frequencySeconds) * 1000;
  const totalTicks = Math.floor((endMs - startMs) / freqMs) + 1;
  const sampleCount = Math.min(maxSamples, Math.max(3, totalTicks));
  const out: Array<{ simTime: Date; tickIndex: number }> = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const tickIndex =
      sampleCount === 1 ? 0 : Math.round((i * (totalTicks - 1)) / (sampleCount - 1));
    const simTime = new Date(startMs + tickIndex * freqMs);
    out.push({ simTime, tickIndex });
  }

  return out;
}

/** True when instructions explicitly describe per-tick gauge semantics (not a running total). */
export function looksLikeExplicitGaugeInstructions(instructionsSlice?: string): boolean {
  const text = instructionsSlice?.trim() ?? "";
  if (!text) return false;
  return (
    /\bper[- ]tick\s+gauge\b/iu.test(text) ||
    /\binstantaneous\s+draw\b/iu.test(text) ||
    /\b(?:not|non[- ])\s*cumulative\b/iu.test(text) ||
    /\bdo not accumulate(?:\s+a)?\s+running\s+total\b/iu.test(text) ||
    /\bfinite number each tick\b/iu.test(text)
  );
}

/** True when metric instructions (natural language) request monotonic cumulative behavior. */
export function looksLikeCumulativeCounter(instructionsSlice?: string): boolean {
  const text = instructionsSlice?.trim() ?? "";
  if (!text) return false;

  if (
    looksLikeExplicitGaugeInstructions(text) &&
    !/\bmonoton(?:ically)?(?:\s+increasing)?\s+cumulative\b/iu.test(text)
  ) {
    return false;
  }

  const keywordPattern =
    /\b(cumulative|accumulated|monoton(?:ically)?(?:\s+increasing)?|counter|running total|never decrease|never drop|strictly increase)\b/iu;
  const phrasePatterns = [
    /\bstart\s+at\s+\d+(?:\.\d+)?\b.*\bthen\s+increase\b/iu,
    /\bprevious\s+value\b/iu,
    /\beach\s+(?:tick|step)\s+add\b/iu,
    /\brunning\s+total\b/iu
  ];

  return keywordPattern.test(text) || phrasePatterns.some((re) => re.test(text));
}

export type SamplingKind = "gauge" | "counter";

const GAUGE_METRIC_STEM_PATTERN =
  /\b(p99|p95|p90|latency|bandwidth|target|throughput|ratio|percent)\b/iu;
const COUNTER_METRIC_STEM_PATTERN =
  /(?:^|[_-])(total|sum|count|joules|cumulative)(?:$|[_-])/iu;

/** Parse all numeric min–max bands from natural-language instructions. */
export function parseInstructionNumericRanges(
  instructionsSlice?: string
): Array<{ min: number; max: number }> {
  const text = instructionsSlice ?? "";
  const ranges: Array<{ min: number; max: number }> = [];
  const re = /\b(\d+(?:\.\d+)?)\s*[-–—to]+\s*(\d+(?:\.\d+)?)\b/giu;
  for (const m of text.matchAll(re)) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      ranges.push({ min, max });
    }
  }
  return ranges;
}

/** True when instructions describe per-tick gauge readings (value bands, not cumulative). */
export function looksLikeGaugeMetric(instructionsSlice?: string, compoundMetric?: string): boolean {
  if (looksLikeCumulativeCounter(instructionsSlice)) return false;
  const text = instructionsSlice?.trim() ?? "";
  const hasRange = parseInstructionNumericRanges(text).length > 0;
  const gaugePhrasing =
    /\b(keep\s+values?\s+in|values?\s+in\s+the|between\s+\d|range\s+of|daily\s+variation|low\s+noise)\b/iu.test(
      text
    );
  const metricStem = compoundMetric?.replace(/_CO[0-9a-f]{32}$/iu, "") ?? "";
  const gaugeStem = GAUGE_METRIC_STEM_PATTERN.test(metricStem);
  const counterStem = COUNTER_METRIC_STEM_PATTERN.test(metricStem);
  if (hasRange || gaugePhrasing) return true;
  if (gaugeStem && !counterStem) return true;
  return false;
}

/** True when instructions mention structured stress dips or short downward episodes. */
export function looksLikeStressDipPattern(instructionsSlice?: string): boolean {
  const text = instructionsSlice?.trim() ?? "";
  if (!text) return false;
  if (/\bdips?\b/iu.test(text) && (/\bstress\b/iu.test(text) || /\b\d{1,2}:\d{2}\b/u.test(text))) {
    return true;
  }
  if (/\bstress\s+period/iu.test(text)) return true;
  return false;
}

export function inferSamplingKind(
  instructionsSlice?: string,
  compoundMetric?: string
): SamplingKind {
  if (looksLikeCumulativeCounter(instructionsSlice)) return "counter";
  if (looksLikeGaugeMetric(instructionsSlice, compoundMetric)) return "gauge";
  return "gauge";
}

/** Module file stems (without .md) to append for codegen system prompt. */
export function resolveCodegenModuleNames(
  instructionsSlice?: string,
  compoundMetric?: string
): string[] {
  if (looksLikeCumulativeCounter(instructionsSlice)) {
    return ["cumulative_codegen"];
  }
  const modules: string[] = [];
  if (looksLikeGaugeMetric(instructionsSlice, compoundMetric)) {
    modules.push("gauge_codegen");
  }
  if (looksLikeStressDipPattern(instructionsSlice)) {
    modules.push("stress_dip_codegen");
  }
  return modules;
}

/** Heuristic: snippet loops over ctx.tickIndex and accumulates with +=. */
export function snippetLooksLikeAccumulationLoop(snippet: string): boolean {
  const t = snippet.trim();
  if (!/\bfor\s*\(/u.test(t) || !/\bctx\.tickIndex\b/u.test(t) || !/\+=(?!=)/u.test(t)) {
    return false;
  }
  return /\bfor\s*\([^)]*ctx\.tickIndex[^)]*\)[^{]*\{[\s\S]*\+=[\s\S]*\}/u.test(t);
}

function historicLateTickIndex(args: SnippetProbeArgs): number | null {
  if (args.mode !== "historic" || !args.historicStartIso || !args.historicEndIso) return null;
  const startMs = Date.parse(args.historicStartIso);
  const endMs = Date.parse(args.historicEndIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  const freqMs = Math.max(1, args.frequencySeconds) * 1000;
  return Math.floor((endMs - startMs) / freqMs);
}

function assertGaugeMagnitude(
  args: SnippetProbeArgs,
  instructionsSlice?: string
): { ok: true } | { ok: false; reason: string } {
  const ranges = parseInstructionNumericRanges(instructionsSlice);
  if (ranges.length === 0) return { ok: true };

  const upperBound = Math.max(...ranges.map((r) => r.max));
  const magnitudeCap = upperBound * 5;

  const early = probeSequentialSnippetValues(args, 12);
  if (!early.ok) return early;

  const allValues = [...early.values];
  const lateTick = historicLateTickIndex(args);
  if (lateTick !== null && lateTick > 11) {
    const startMs = Date.parse(args.historicStartIso!);
    const freqMs = Math.max(1, args.frequencySeconds) * 1000;
    const lateProbe = probeAtTickIndices(args, [lateTick], startMs, freqMs);
    if (!lateProbe.ok) return lateProbe;
    allValues.push(...lateProbe.values);
  }

  for (const v of allValues) {
    if (v > magnitudeCap) {
      return {
        ok: false,
        reason:
          `Generated snippet returned ${v}, far above instruction range max ${upperBound}. ` +
          "Values look like a running total, not a per-tick gauge. Return one sample for the current tick only; do not loop 0..ctx.tickIndex summing increments."
      };
    }
  }

  if (early.values.length >= 2 && lateTick !== null && lateTick > 11) {
    const first = early.values[0]!;
    const late = allValues[allValues.length - 1]!;
    if (late > first + upperBound * 10) {
      return {
        ok: false,
        reason:
          `Generated snippet grows from ${first} at tick 0 to ${late} at tick ${lateTick}, suggesting accumulation. ` +
          "Return a per-tick gauge in the requested range, not a running total."
      };
    }
    let strictlyIncreasing = true;
    for (let i = 1; i < early.values.length; i += 1) {
      if (early.values[i]! <= early.values[i - 1]!) {
        strictlyIncreasing = false;
        break;
      }
    }
    const avgStep =
      (early.values[early.values.length - 1]! - early.values[0]!) / (early.values.length - 1);
    if (strictlyIncreasing && avgStep >= upperBound * 0.3) {
      return {
        ok: false,
        reason:
          "Generated snippet increases monotonically across early ticks with step size near the instruction range — likely a running total. Return a per-tick gauge sample."
      };
    }
  }

  return { ok: true };
}

/** Max ticks to execute when validating cumulative snippets (monotonic failures surface early). */
export const CUMULATIVE_VALIDATION_PROBE_CAP = 128;

/** Tick count for cumulative monotonic probe during codegen validation. */
export function cumulativeProbeTickCount(
  args: SnippetProbeArgs,
  cap = CUMULATIVE_VALIDATION_PROBE_CAP,
): number {
  if (args.mode === "historic" && args.historicStartIso && args.historicEndIso) {
    const startMs = Date.parse(args.historicStartIso);
    const endMs = Date.parse(args.historicEndIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 12;
    const freqMs = Math.max(1, args.frequencySeconds) * 1000;
    const totalTicks = Math.floor((endMs - startMs) / freqMs) + 1;
    return Math.min(Math.max(2, totalTicks), cap);
  }
  return 120;
}

function assertMonotonicIncreasing(values: number[]): { ok: true } | { ok: false; reason: string } {
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < values[i - 1]) {
      return {
        ok: false,
        reason:
          `Generated snippet decreases between tick ${i - 1} (${values[i - 1]}) and tick ${i} (${values[i]}). ` +
          "Cumulative counters must return a running total: loop i=1..ctx.tickIndex summing positive increments. " +
          "Do not return a per-tick increment, gauge sample, or baseline + ctx.tickIndex * increment (that pattern can decrease when the random factor varies per tick)."
      };
    }
  }
  return { ok: true };
}

function probeAtTickIndices(
  args: SnippetProbeArgs,
  tickIndices: number[],
  startMs?: number,
  freqMs?: number
): { ok: true; values: number[] } | { ok: false; reason: string } {
  let run: (ctx: SnippetCtx) => number;
  try {
    run = compileSnippet(args.snippet);
  } catch (e) {
    return { ok: false, reason: `Snippet failed to compile: ${String(e)}` };
  }

  const values: number[] = [];
  for (const tickIndex of tickIndices) {
    const simTime =
      startMs !== undefined && freqMs !== undefined
        ? new Date(startMs + tickIndex * freqMs)
        : new Date(Date.now() + tickIndex * Math.max(1, args.frequencySeconds) * 1000);
    try {
      const value = Number(
        run(buildCtx(args, simTime, tickIndex, args.mode === "streaming" ? simTime.getTime() : undefined))
      );
      if (!Number.isFinite(value)) {
        return { ok: false, reason: "Snippet returned non-numeric value during probe." };
      }
      values.push(value);
    } catch (e) {
      return { ok: false, reason: `Snippet threw during probe: ${String(e)}` };
    }
  }

  return { ok: true, values };
}

/** Probe early sequential ticks — catches per-tick gauges masquerading as counters. */
export function probeSequentialSnippetValues(
  args: SnippetProbeArgs,
  tickCount = 12
): { ok: true; values: number[] } | { ok: false; reason: string } {
  const n = Math.max(2, tickCount);
  if (args.mode === "historic" && args.historicStartIso && args.historicEndIso) {
    const startMs = Date.parse(args.historicStartIso);
    const endMs = Date.parse(args.historicEndIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return { ok: false, reason: "Could not derive sequential ticks for snippet probe." };
    }
    const freqMs = Math.max(1, args.frequencySeconds) * 1000;
    const totalTicks = Math.floor((endMs - startMs) / freqMs) + 1;
    const count = Math.min(n, totalTicks);
    return probeAtTickIndices(
      args,
      Array.from({ length: count }, (_, i) => i),
      startMs,
      freqMs
    );
  }

  return probeAtTickIndices(
    args,
    Array.from({ length: n }, (_, i) => i),
    undefined,
    undefined
  );
}

export type StressHourWindow = { startHour: number; endHour: number };

/** Parse clock stress windows like `08:00-09:00` from natural-language instructions. */
export function parseStressHourWindows(instructionsSlice?: string): StressHourWindow[] {
  const text = instructionsSlice ?? "";
  const windows: StressHourWindow[] = [];
  const re = /\b(\d{1,2}):(\d{2})\s*[-–—to]+\s*(\d{1,2}):(\d{2})\b/giu;
  for (const m of text.matchAll(re)) {
    const startHour = Number(m[1]);
    const endHour = Number(m[3]);
    if (
      Number.isFinite(startHour) &&
      Number.isFinite(endHour) &&
      startHour >= 0 &&
      startHour < 24 &&
      endHour > startHour &&
      endHour <= 24
    ) {
      windows.push({ startHour, endHour });
    }
  }
  return windows;
}

/** Upper bound for dip-band detection (e.g. 300 from "200-300" → threshold 350). */
export function parseStressDipThreshold(instructionsSlice?: string): number | null {
  const ranges = parseInstructionNumericRanges(instructionsSlice);
  // Ignore short duration bands (e.g. "3-10 minutes"); keep magnitude bands like 200-300.
  const dipRanges = ranges.filter((r) => r.max >= 100 && r.max <= 2_000);
  if (dipRanges.length === 0) return null;
  const dipMax = Math.min(...dipRanges.map((r) => r.max));
  return dipMax + 50;
}

function isInStressWindow(localHour: number, window: StressHourWindow): boolean {
  return localHour >= window.startHour && localHour < window.endHour;
}

/** Require dip samples in stress windows on at least two distinct simulated days. */
export function assertStressDipEpisodes(
  args: SnippetProbeArgs,
  instructionsSlice?: string
): { ok: true } | { ok: false; reason: string } {
  const windows = parseStressHourWindows(instructionsSlice);
  const dipThreshold = parseStressDipThreshold(instructionsSlice);
  if (windows.length === 0 || dipThreshold === null) {
    return { ok: true };
  }

  if (args.mode !== "historic" || !args.historicStartIso || !args.historicEndIso) {
    return { ok: true };
  }

  const startMs = Date.parse(args.historicStartIso);
  const endMs = Date.parse(args.historicEndIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { ok: false, reason: "Could not derive historic window for stress-dip validation." };
  }

  const freqMs = Math.max(1, args.frequencySeconds) * 1000;
  const totalTicks = Math.floor((endMs - startMs) / freqMs) + 1;
  const totalDays = Math.max(1, Math.ceil((endMs - startMs) / 86_400_000));

  let run: (ctx: SnippetCtx) => number;
  try {
    run = compileSnippet(args.snippet);
  } catch (e) {
    return { ok: false, reason: `Snippet failed to compile: ${String(e)}` };
  }

  const ticksPerDay = Math.max(1, Math.floor(86_400 / args.frequencySeconds));
  const dayIndices =
    totalDays >= 3
      ? [0, Math.floor(totalDays / 2), totalDays - 1]
      : Array.from({ length: totalDays }, (_, i) => i);

  for (const window of windows) {
    const dipDays = new Set<number>();

    for (const dayIndex of dayIndices) {
      const dayStartTick = dayIndex * ticksPerDay;
      const dayEndTick = Math.min((dayIndex + 1) * ticksPerDay - 1, totalTicks - 1);
      let sawDip = false;

      for (let tickIndex = dayStartTick; tickIndex <= dayEndTick; tickIndex += 1) {
        const simTime = new Date(startMs + tickIndex * freqMs);
        const ctx = buildCtx(args, simTime, tickIndex);
        if (!isInStressWindow(ctx.localHour, window)) continue;

        let value: number;
        try {
          value = Number(run(ctx));
        } catch (e) {
          return { ok: false, reason: `Snippet threw during stress-dip probe: ${String(e)}` };
        }
        if (!Number.isFinite(value)) {
          return { ok: false, reason: "Snippet returned non-numeric value during stress-dip probe." };
        }
        if (value < dipThreshold) {
          sawDip = true;
          break;
        }
      }

      if (sawDip) {
        dipDays.add(dayIndex);
      }
    }

    if (dipDays.size < 2) {
      return {
        ok: false,
        reason:
          `Generated snippet produced fewer than 2 stress-window dip days for ${window.startHour}:00-${window.endHour}:00 ` +
          `(found ${dipDays.size}; need samples below ${dipThreshold}). ` +
          "Schedule dip episodes with ctx.tickInHour inside the stress hour, not global ctx.tickIndex offsets."
      };
    }
  }

  return { ok: true };
}

/** Reject cumulative joules on power-consumption (W gauge) — belongs on energy-consumption. */
export function assertPowerEnergySemantics(
  compoundMetric: string,
  instructionsSlice?: string
): { ok: true } | { ok: false; reason: string } {
  if (!looksLikeCumulativeCounter(instructionsSlice)) return { ok: true };

  const stem = compoundMetric.replace(/_CO[0-9a-f]{32}$/iu, "").toLowerCase();
  const mentionsJoules = /\bjoules?\b/iu.test(instructionsSlice ?? "");
  if (stem === "power-consumption" || (stem.includes("power") && mentionsJoules)) {
    return {
      ok: false,
      reason:
        "Cumulative joules instructions belong on energy-consumption (unit J), not power-consumption (unit W gauge). " +
        "Use metric=energy-consumption for a monotonic cumulative counter, or gauge watts for power-consumption."
    };
  }
  return { ok: true };
}

export function probeSnippetValues(args: SnippetProbeArgs): { ok: true; values: number[] } | { ok: false; reason: string } {
  let run: (ctx: SnippetCtx) => number;
  try {
    run = compileSnippet(args.snippet);
  } catch (e) {
    return { ok: false, reason: `Snippet failed to compile: ${String(e)}` };
  }

  const maxSamples = args.maxSamples ?? 24;
  const samples: Array<{ simTime: Date; tickIndex: number; wallMs?: number }> =
    args.mode === "historic" && args.historicStartIso && args.historicEndIso
      ? historicSampleTimes(
          args.historicStartIso,
          args.historicEndIso,
          args.frequencySeconds,
          maxSamples
        )
      : [
          { simTime: new Date(), tickIndex: 0, wallMs: Date.now() },
          { simTime: new Date(Date.now() + 6 * 3600_000), tickIndex: 360, wallMs: Date.now() + 6 * 3600_000 },
          { simTime: new Date(Date.now() + 12 * 3600_000), tickIndex: 720, wallMs: Date.now() + 12 * 3600_000 }
        ];

  if (samples.length === 0) {
    return { ok: false, reason: "Could not derive sample ticks for snippet probe." };
  }

  const values: number[] = [];
  for (const sample of samples) {
    try {
      const value = Number(run(buildCtx(args, sample.simTime, sample.tickIndex, sample.wallMs)));
      if (!Number.isFinite(value)) {
        return { ok: false, reason: "Snippet returned non-numeric value during probe." };
      }
      values.push(value);
    } catch (e) {
      return { ok: false, reason: `Snippet threw during probe: ${String(e)}` };
    }
  }

  return { ok: true, values };
}

/** Reject snippets that always return 0 or never vary when a numeric range is implied. */
export function validateSnippetSamples(
  args: SnippetProbeArgs & { instructionsSlice?: string }
): { ok: true } | { ok: false; reason: string } {
  const probe = probeSnippetValues(args);
  if (!probe.ok) return probe;

  const { values } = probe;
  if (values.every((v) => v === 0)) {
    return {
      ok: false,
      reason:
        "Generated snippet returns 0 for every probed tick. Use ctx.localHour for day/night patterns (not raw UTC unless intended), and avoid literal zero for off-hours when instructions specify a numeric range."
    };
  }

  const rangeMatch = (args.instructionsSlice ?? "").match(/\b(\d+(?:\.\d+)?)\s*[-–—to]+\s*(\d+(?:\.\d+)?)\b/u);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      const spread = Math.max(...values) - Math.min(...values);
      if (spread === 0) {
        return {
          ok: false,
          reason: `Generated snippet is constant (${values[0]}) across probed ticks but instructions imply variation within ${min}-${max}.`
        };
      }
    }
  }

  if (looksLikeCumulativeCounter(args.instructionsSlice)) {
    const tickCount = cumulativeProbeTickCount(args);
    const sequential = probeSequentialSnippetValues(args, tickCount);
    if (!sequential.ok) return sequential;
    const monotonic = assertMonotonicIncreasing(sequential.values);
    if (!monotonic.ok) return monotonic;
  } else {
    if (snippetLooksLikeAccumulationLoop(args.snippet)) {
      return {
        ok: false,
        reason:
          "Generated snippet loops over ctx.tickIndex and accumulates with +=. For gauge instructions, return one sample for the current tick only; do not sum history."
      };
    }
    if (looksLikeGaugeMetric(args.instructionsSlice, args.compoundMetric)) {
      const gaugeCheck = assertGaugeMagnitude(args, args.instructionsSlice);
      if (!gaugeCheck.ok) return gaugeCheck;
    }
    if (looksLikeStressDipPattern(args.instructionsSlice)) {
      const dipCheck = assertStressDipEpisodes(args, args.instructionsSlice);
      if (!dipCheck.ok) return dipCheck;
    }
  }

  const semanticsCheck = assertPowerEnergySemantics(args.compoundMetric, args.instructionsSlice);
  if (!semanticsCheck.ok) return semanticsCheck;

  return { ok: true };
}
