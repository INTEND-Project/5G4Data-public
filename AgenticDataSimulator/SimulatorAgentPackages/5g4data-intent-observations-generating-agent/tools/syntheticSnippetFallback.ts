import type { SyntheticCodegenContextSlice } from "./syntheticLlmCodegen.js";
import {
  inferSamplingKind,
  looksLikeStressDipPattern,
  parseInstructionNumericRanges,
  parseStressDipThreshold,
  parseStressHourWindows,
  validateSnippetSamples,
} from "./syntheticSnippetProbe.js";

function parseStartAtBaseline(instructionsSlice: string): number {
  const match = instructionsSlice.match(/\bstart\s+at\s+(\d+(?:\.\d+)?)/iu);
  if (match?.[1]) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return 10;
}

function parseBaseIncrement(instructionsSlice: string, frequencySeconds: number): number {
  const match =
    instructionsSlice.match(
      /\b(?:base\s+)?(?:off-peak\s+)?increment\s+is\s+(\d+(?:\.\d+)?)/iu,
    ) ??
    instructionsSlice.match(/\badd\s+(?:a\s+)?(?:strictly\s+positive\s+)?increment[^0-9]*(\d+(?:\.\d+)?)/iu);
  let increment = match?.[1] ? Number(match[1]) : 8;
  if (!Number.isFinite(increment) || increment <= 0) increment = 8;

  const perMinutes = instructionsSlice.match(/\bper\s+(\d+)\s*m(?:in(?:ute)?s?)?\b/iu);
  if (perMinutes?.[1]) {
    const instructionFreqSeconds = Number(perMinutes[1]) * 60;
    if (instructionFreqSeconds > 0) {
      increment *= frequencySeconds / instructionFreqSeconds;
    }
  }

  return Math.max(0.001, increment);
}

function significantInstructionRanges(
  instructionsSlice: string,
): Array<{ min: number; max: number }> {
  return parseInstructionNumericRanges(instructionsSlice).filter((range) => range.max >= 100);
}

function pickDefaultGaugeBand(instructionsSlice: string): { low: number; high: number } {
  const ranges = significantInstructionRanges(instructionsSlice);
  if (ranges.length === 0) {
    return { low: 700, high: 1500 };
  }
  const widest = ranges.reduce((best, range) =>
    range.max - range.min > best.max - best.min ? range : best,
  );
  return { low: widest.min, high: widest.max };
}

function pickDaytimeGaugeBand(instructionsSlice: string): { low: number; high: number } {
  const ranges = significantInstructionRanges(instructionsSlice);
  const daytime = ranges.find(
    (range) => range.min >= 400 && range.max <= 1_200 && range.max - range.min <= 700,
  );
  if (daytime) {
    return { low: daytime.min, high: daytime.max };
  }
  return pickDefaultGaugeBand(instructionsSlice);
}

function pickDipBand(instructionsSlice: string): { low: number; high: number } {
  const ranges = significantInstructionRanges(instructionsSlice).filter(
    (range) => range.max <= 2_000,
  );
  if (ranges.length === 0) {
    return { low: 200, high: 300 };
  }
  const dip = ranges.reduce((best, range) => (range.max < best.max ? range : best));
  return { low: dip.min, high: dip.max };
}

function buildCumulativeFallbackSnippet(slice: SyntheticCodegenContextSlice): string {
  const instructions = slice.instructionsSlice ?? "";
  const baseline = parseStartAtBaseline(instructions);
  const increment = parseBaseIncrement(instructions, slice.frequencySeconds);

  return `
let total = ${baseline};
for (let i = 1; i <= ctx.tickIndex; i++) {
  let stepInc = ${increment} * (0.7 + 0.6 * ctx.uniformForStep(i));
  const stepSeconds = i * ctx.frequencySeconds;
  const stepHour = Math.floor((stepSeconds % 86400) / 3600);
  if (stepHour >= 22 || stepHour < 6) {
    stepInc *= 0.5;
  } else if (stepHour >= 6 && stepHour < 18) {
    stepInc *= 1.5;
  }
  if ((stepHour >= 8 && stepHour < 9) || (stepHour >= 16 && stepHour < 17)) {
    stepInc *= 3;
  }
  total += stepInc;
}
return total;
`.trim();
}

/** @internal Exported for regression tests. */
export function buildStressDipGaugeFallbackSnippet(slice: SyntheticCodegenContextSlice): string {
  const instructions = slice.instructionsSlice ?? "";
  const defaultBand = pickDefaultGaugeBand(instructions);
  const daytimeBand = pickDaytimeGaugeBand(instructions);
  const dipBand = pickDipBand(instructions);
  const daytimeSpan = Math.max(1, daytimeBand.high - daytimeBand.low);
  const defaultSpan = Math.max(1, defaultBand.high - defaultBand.low);
  const dipSpan = Math.max(1, dipBand.high - dipBand.low);
  const windows = parseStressHourWindows(instructions);
  const morning = windows.find((window) => window.startHour === 8) ?? { startHour: 8, endHour: 9 };
  const afternoon = windows.find((window) => window.startHour === 16) ?? { startHour: 16, endHour: 17 };

  return `
const hour = ctx.localHour;
let value = ${defaultBand.low} + ctx.uniform01() * ${defaultSpan};
if (hour >= 6 && hour < 18) {
  value = ${daytimeBand.low} + ctx.uniform01() * ${daytimeSpan};
}
const isStress = (hour >= ${morning.startHour} && hour < ${morning.endHour}) || (hour >= ${afternoon.startHour} && hour < ${afternoon.endHour});
if (isStress) {
  const windowId = hour >= ${morning.startHour} && hour < ${morning.endHour} ? 0 : 1;
  const ticksPerHour = Math.ceil(3600 / ctx.frequencySeconds);
  for (let dipIndex = 0; dipIndex < 2; dipIndex += 1) {
    const key = ctx.tickInDay * 1000 + windowId * 100 + dipIndex;
    const dipDuration = 3 + Math.floor(ctx.uniformForStep(key + 1) * 8);
    const maxStart = ticksPerHour - dipDuration;
    const dipStart = Math.floor(ctx.uniformForStep(key) * Math.max(1, maxStart));
    if (ctx.tickInHour >= dipStart && ctx.tickInHour < dipStart + dipDuration) {
      value = ${dipBand.low} + ctx.uniform01() * ${dipSpan};
      break;
    }
  }
}
return value;
`.trim();
}

function buildGaugeFallbackSnippet(slice: SyntheticCodegenContextSlice): string {
  const instructions = slice.instructionsSlice ?? "";
  const band = pickDefaultGaugeBand(instructions);
  const span = Math.max(1, band.high - band.low);
  return `
const hour = ctx.localHour;
let value = ${band.low} + ctx.uniform01() * ${span};
if (hour >= 6 && hour < 18) {
  value = ${Math.max(band.low, band.low + span * 0.2)} + ctx.uniform01() * ${Math.max(1, span * 0.6)};
}
return value;
`.trim();
}

function validateFallbackSnippet(
  snippet: string,
  slice: SyntheticCodegenContextSlice,
): { ok: true } | { ok: false; reason: string } {
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
    instructionsSlice: slice.instructionsSlice,
  });
}

/** Deterministic snippet that passes probe validation when LLM codegen fails. */
export function buildValidatedFallbackSnippet(
  slice: SyntheticCodegenContextSlice,
): { ok: true; snippet: string } | { ok: false; reason: string } {
  const kind = inferSamplingKind(slice.instructionsSlice, slice.compoundMetric);
  const candidates =
    kind === "counter"
      ? [buildCumulativeFallbackSnippet(slice)]
      : looksLikeStressDipPattern(slice.instructionsSlice)
        ? [buildStressDipGaugeFallbackSnippet(slice), buildGaugeFallbackSnippet(slice)]
        : [buildGaugeFallbackSnippet(slice)];

  for (const snippet of candidates) {
    const validation = validateFallbackSnippet(snippet, slice);
    if (validation.ok) {
      return { ok: true, snippet };
    }
  }

  const last = validateFallbackSnippet(candidates[0]!, slice);
  return { ok: false, reason: last.ok ? "Fallback snippet unavailable." : last.reason };
}
