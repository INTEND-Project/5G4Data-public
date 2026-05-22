import type { SyntheticMode } from "./syntheticPrompt.js";
import { compileSnippet, type SnippetCtx } from "./syntheticMetricWorker.js";
import { hashSeed, localHourFromSim, mulberry32, parseUtcOffsetMinutes } from "./syntheticPrng.js";

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
    unitHint: args.unitHint ?? "NA",
    utcOffsetMinutes,
    localHour: localHourFromSim(simTime, utcOffsetMinutes)
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

  return { ok: true };
}
