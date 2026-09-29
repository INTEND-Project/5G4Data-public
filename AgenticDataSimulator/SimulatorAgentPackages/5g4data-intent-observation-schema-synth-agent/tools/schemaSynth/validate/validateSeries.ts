import type { ConstraintDocument } from "../schema/types.js";
import { dslDateToIso } from "../parseGlobals.js";
import type { MetricSeries, SamplePoint } from "../render/renderer.js";

export interface ValidationCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface SeriesValidationResult {
  ok: boolean;
  checks: ValidationCheck[];
}

function parseIsoMs(raw: string): number {
  return Date.parse(dslDateToIso(raw));
}

function hourOf(tMs: number): number {
  return new Date(tMs).getUTCHours();
}

function hourInWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function lag1Autocorr(xs: number[]): number {
  if (xs.length < 3) return 0;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const d = xs[i] - m;
    den += d * d;
    if (i > 0) num += (xs[i - 1] - m) * d;
  }
  return den === 0 ? 0 : num / den;
}

function findRuns(
  samples: SamplePoint[],
  pred: (v: number) => boolean
): Array<{ startIdx: number; length: number }> {
  const runs: Array<{ startIdx: number; length: number }> = [];
  let i = 0;
  while (i < samples.length) {
    if (!pred(samples[i].value)) {
      i += 1;
      continue;
    }
    const startIdx = i;
    while (i < samples.length && pred(samples[i].value)) i += 1;
    runs.push({ startIdx, length: i - startIdx });
  }
  return runs;
}

function bandSlack(band: { min: number; max: number }, noise: ConstraintDocument["noise"]): number {
  const width = band.max - band.min;
  const frac = noise === "high" ? 0.2 : noise === "medium" ? 0.12 : noise === "none" ? 0.02 : 0.08;
  return Math.max(width * frac, 1e-6);
}

function mostlyInBand(
  values: number[],
  band: { min: number; max: number },
  slack: number,
  minFraction = 0.85
): boolean {
  if (values.length === 0) return true;
  const ok = values.filter((v) => v >= band.min - slack && v <= band.max + slack).length;
  return ok / values.length >= minFraction;
}

export function validateMetricSeries(
  doc: ConstraintDocument,
  series: MetricSeries
): SeriesValidationResult {
  const checks: ValidationCheck[] = [];
  if (!doc.timeline.start || !doc.timeline.stop) {
    return {
      ok: false,
      checks: [{ id: "timeline", ok: false, detail: "historic validation requires timeline.start/stop" }]
    };
  }
  const startMs = parseIsoMs(doc.timeline.start);
  const stopMs = parseIsoMs(doc.timeline.stop);
  const freq = doc.timeline.frequencySeconds;
  const expected = Math.floor((stopMs - startMs) / (freq * 1000));

  checks.push({
    id: "sample_count",
    ok: series.samples.length === expected,
    detail: `expected ${expected} samples, got ${series.samples.length}`
  });

  if (doc.samplingKind === "counter") {
    let mono = true;
    for (let i = 1; i < series.samples.length; i += 1) {
      if (series.samples[i].value + 1e-9 < series.samples[i - 1].value) {
        mono = false;
        break;
      }
    }
    checks.push({
      id: "counter_monotonic",
      ok: mono,
      detail: mono ? "non-decreasing" : "found a decrease"
    });
  }

  if (doc.defaultBand && doc.samplingKind === "gauge") {
    const slack = bandSlack(doc.defaultBand, doc.noise);
    const outsideWindow = series.samples.filter((s) => {
      const h = hourOf(s.tMs);
      return !(doc.recurringWindows ?? []).some((w) => hourInWindow(h, w.startHour, w.endHour));
    });
    // Exclude absolute override ticks and episode-ish outliers loosely: use 70% for default when process present
    const minFrac = doc.seasonality || doc.residual ? 0.7 : 0.8;
    const vals = outsideWindow.map((s) => s.value);
    const ok = mostlyInBand(vals, doc.defaultBand, slack, minFrac);
    checks.push({
      id: "default_band",
      ok,
      detail: ok
        ? `default-band occupancy ok (${vals.length} points)`
        : `too many values outside defaultBand ${doc.defaultBand.min}-${doc.defaultBand.max}`
    });
  }

  for (const [wi, w] of (doc.recurringWindows ?? []).entries()) {
    const slack = bandSlack(w.band, w.noise ?? doc.noise);
    const vals = series.samples
      .filter((s) => hourInWindow(hourOf(s.tMs), w.startHour, w.endHour))
      .map((s) => s.value);
    const ok = mostlyInBand(vals, w.band, slack, 0.75);
    checks.push({
      id: `recurring_window_${wi}`,
      ok,
      detail: ok
        ? `window ${w.startHour}-${w.endHour} ok`
        : `window ${w.startHour}-${w.endHour} band ${w.band.min}-${w.band.max} occupancy failed`
    });
  }

  for (const [ei, episode] of (doc.episodes ?? []).entries()) {
    for (const [wi, w] of episode.windows.entries()) {
      const inWindow = series.samples.filter((s) =>
        hourInWindow(hourOf(s.tMs), w.startHour, w.endHour)
      );
      const mid = (episode.band.min + episode.band.max) / 2;
      const pred =
        episode.type === "dip"
          ? (v: number) => v <= episode.band.max * 1.15
          : (v: number) => v >= episode.band.min * 0.85;
      // Group by day
      const byDay = new Map<number, SamplePoint[]>();
      for (const s of inWindow) {
        const day = Math.floor((s.tMs - startMs) / 86_400_000);
        const arr = byDay.get(day) ?? [];
        arr.push(s);
        byDay.set(day, arr);
      }
      let daysOk = 0;
      let daysChecked = 0;
      for (const [, daySamples] of byDay) {
        daysChecked += 1;
        const runs = findRuns(daySamples, pred).filter((r) => {
          const durMin = (r.length * freq) / 60;
          return (
            durMin >= episode.durationMinutes.min * 0.5 &&
            durMin <= episode.durationMinutes.max * 1.5
          );
        });
        // Also require values near episode band for run membership
        const bandRuns = findRuns(daySamples, (v) => {
          if (episode.type === "dip") return v <= episode.band.max + bandSlack(episode.band, doc.noise);
          return v >= episode.band.min - bandSlack(episode.band, doc.noise);
        }).filter((r) => {
          const durMin = (r.length * freq) / 60;
          return (
            durMin >= episode.durationMinutes.min * 0.5 &&
            durMin <= episode.durationMinutes.max * 1.5
          );
        });
        if (bandRuns.length >= episode.countPerWindow.atLeast) daysOk += 1;
      }
      const ok = daysChecked === 0 || daysOk >= Math.ceil(daysChecked * 0.5);
      checks.push({
        id: `episode_${ei}_window_${wi}`,
        ok,
        detail: ok
          ? `episode ${episode.type} in ${w.startHour}-${w.endHour}: ${daysOk}/${daysChecked} days ok (need ≥${episode.countPerWindow.atLeast})`
          : `episode ${episode.type} in ${w.startHour}-${w.endHour}: only ${daysOk}/${daysChecked} days met count/duration (mid≈${mid})`
      });
    }
  }

  if (doc.seasonality && doc.samplingKind === "gauge") {
    const dayVals = series.samples
      .filter((s) => {
        const h = hourOf(s.tMs);
        return h >= 10 && h < 16;
      })
      .map((s) => s.value);
    const nightVals = series.samples
      .filter((s) => {
        const h = hourOf(s.tMs);
        return h >= 0 && h < 5;
      })
      .map((s) => s.value);
    const sep = Math.abs(mean(dayVals) - mean(nightVals));
    const ok = sep >= doc.seasonality.amplitude * 0.25;
    checks.push({
      id: "seasonality_amplitude",
      ok,
      detail: `day/night mean separation ${sep.toFixed(2)} (amplitude ${doc.seasonality.amplitude})`
    });
  }

  if (doc.shocks && doc.shocks.ratePerDay > 0) {
    const durationDays = (stopMs - startMs) / 86_400_000;
    const expectedShocks = doc.shocks.ratePerDay * durationDays;
    const values = series.samples.map((s) => s.value);
    const m = mean(values);
    const sorted = [...values].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? m;
    const spikes = values.filter((v) => v >= p95).length;
    // Loose: expect some elevated tail relative to shock rate
    const ok = spikes >= Math.max(1, expectedShocks * 0.5);
    checks.push({
      id: "shock_count",
      ok,
      detail: `tail ticks ≥p95: ${spikes}, expected around ${expectedShocks.toFixed(1)} (loose)`
    });
  }

  if (doc.residual?.type === "ar1" && series.samples.length > 10) {
    let meanLevel = levelMeanSafe(doc);
    const detrended = series.samples.map((s, i) => {
      let seasonal = 0;
      if (doc.seasonality) {
        const periodSec = doc.seasonality.periodHours * 3600;
        const phaseSec = (doc.seasonality.phaseHours ?? 0) * 3600;
        const tau = ((s.tMs / 1000 + phaseSec) % periodSec) / periodSec;
        seasonal = doc.seasonality.amplitude * Math.sin(2 * Math.PI * tau);
      }
      return s.value - meanLevel - seasonal;
    });
    const ac = lag1Autocorr(detrended);
    const ok = ac > 0.05;
    checks.push({
      id: "ar1_autocorr",
      ok,
      detail: `lag-1 autocorr ${ac.toFixed(3)} (want > 0.05)`
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

function levelMeanSafe(doc: ConstraintDocument): number {
  if (doc.level === undefined) {
    if (doc.defaultBand) return (doc.defaultBand.min + doc.defaultBand.max) / 2;
    return 0;
  }
  if (typeof doc.level === "number") return doc.level;
  return doc.level.mean;
}

export function validateAllSeries(
  doc: ConstraintDocument,
  seriesList: MetricSeries[]
): SeriesValidationResult {
  const checks: ValidationCheck[] = [];
  for (const series of seriesList) {
    const r = validateMetricSeries(doc, series);
    for (const c of r.checks) {
      checks.push({ ...c, id: `${series.metric}:${c.id}`, detail: `[${series.metric}] ${c.detail}` });
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}
