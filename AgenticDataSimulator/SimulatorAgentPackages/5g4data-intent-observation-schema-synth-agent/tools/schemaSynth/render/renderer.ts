import type {
  Band,
  ConstraintDocument,
  Episode,
  RecurringWindow
} from "../schema/types.js";
import { dslDateToIso } from "../parseGlobals.js";
import { gaussianForKey, hashSeed, studentTForKey, uniformForKey } from "./rng.js";

export interface SamplePoint {
  tMs: number;
  value: number;
}

export interface MetricSeries {
  metric: string;
  samples: SamplePoint[];
}

export interface MetricSampler {
  sample(tMs: number): number;
  readonly tickIndex: number;
}

function noiseFraction(level: ConstraintDocument["noise"] | undefined): number {
  switch (level) {
    case "none":
      return 0;
    case "medium":
      return 0.08;
    case "high":
      return 0.15;
    case "low":
    default:
      return 0.04;
  }
}

function sampleInBand(band: Band, u: number, noiseLevel?: ConstraintDocument["noise"]): number {
  const width = Math.max(0, band.max - band.min);
  if (width === 0) return band.min;
  const center = band.min + u * width;
  const nf = noiseFraction(noiseLevel);
  if (nf <= 0) return clamp(center, band.min, band.max);
  const jitter = (u - 0.5) * 2 * nf * width;
  return clamp(center + jitter, band.min, band.max);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function parseIsoMs(raw: string): number {
  const iso = dslDateToIso(raw);
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid timestamp: ${raw}`);
  }
  return ms;
}

function localHour(tMs: number, utcOffsetMinutes = 0): number {
  const d = new Date(tMs + utcOffsetMinutes * 60_000);
  return d.getUTCHours();
}

function hourInWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function activeBand(
  doc: ConstraintDocument,
  tMs: number,
  hour: number
): Band | undefined {
  for (const ov of doc.absoluteOverrides ?? []) {
    const a = parseIsoMs(ov.start);
    const b = parseIsoMs(ov.stop);
    if (tMs >= a && tMs < b) return ov.band;
  }
  const matches = (doc.recurringWindows ?? []).filter((w) =>
    hourInWindow(hour, w.startHour, w.endHour)
  );
  if (matches.length === 0) return doc.defaultBand;
  matches.sort((a, b) => {
    const da = (a.endHour - a.startHour + 24) % 24 || 24;
    const db = (b.endHour - b.startHour + 24) % 24 || 24;
    return da - db;
  });
  return matches[0].band;
}

function levelMean(doc: ConstraintDocument): number {
  if (doc.level === undefined) {
    if (doc.defaultBand) return (doc.defaultBand.min + doc.defaultBand.max) / 2;
    return 0;
  }
  if (typeof doc.level === "number") return doc.level;
  return doc.level.mean;
}

interface ScheduledEpisode {
  windowId: number;
  dipIndex: number;
  startTickInHour: number;
  durationTicks: number;
  band: Band;
  type: "dip" | "spike";
}

function scheduleEpisodesForDay(
  episode: Episode,
  windowId: number,
  startHour: number,
  endHour: number,
  dayKey: string,
  frequencySeconds: number,
  baseSeed: number
): ScheduledEpisode[] {
  const ticksPerHour = Math.max(1, Math.ceil(3600 / frequencySeconds));
  const windowHours = Math.max(1, (endHour - startHour + 24) % 24 || 24);
  const ticksInWindow = ticksPerHour * windowHours;
  const count = episode.countPerWindow.atLeast;
  const out: ScheduledEpisode[] = [];
  let cursor = 0;
  for (let dipIndex = 0; dipIndex < count; dipIndex += 1) {
    const key = `${dayKey}:w${windowId}:e${dipIndex}`;
    const durMin =
      episode.durationMinutes.min +
      uniformForKey(baseSeed, `${key}:dur`) *
        (episode.durationMinutes.max - episode.durationMinutes.min);
    const durationTicks = Math.max(
      1,
      Math.round((durMin * 60) / frequencySeconds)
    );
    const maxStart = Math.max(0, ticksInWindow - durationTicks - cursor);
    const startTickInHour =
      cursor + Math.floor(uniformForKey(baseSeed, `${key}:start`) * Math.max(1, maxStart + 1));
    out.push({
      windowId,
      dipIndex,
      startTickInHour,
      durationTicks,
      band: episode.band,
      type: episode.type
    });
    cursor = startTickInHour + durationTicks + 1;
    if (cursor >= ticksInWindow) break;
  }
  return out;
}

function episodeValueAt(
  schedules: ScheduledEpisode[],
  tickInWindow: number
): Band | undefined {
  for (const ep of schedules) {
    if (
      tickInWindow >= ep.startTickInHour &&
      tickInWindow < ep.startTickInHour + ep.durationTicks
    ) {
      return ep.band;
    }
  }
  return undefined;
}

function hasProcess(doc: ConstraintDocument): boolean {
  return Boolean(doc.seasonality || doc.residual || doc.shocks || doc.level !== undefined);
}

function utcDayKey(tMs: number): string {
  const d = new Date(tMs);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function dayIndexFromEpoch(tMs: number): number {
  return Math.floor(tMs / 86_400_000);
}

/**
 * Stateful per-metric sampler for historic batch and wall-clock streaming.
 * Maintains AR(1)/counter state across ticks; episode schedules are day-keyed.
 */
export function createMetricSampler(
  doc: ConstraintDocument,
  metricName: string,
  options?: { seedOverride?: string | number; epochStartMs?: number }
): MetricSampler {
  const freq = doc.timeline.frequencySeconds;
  const stepMs = freq * 1000;
  const seedSource = options?.seedOverride ?? doc.seed ?? "schema-synth";
  const baseSeed = hashSeed(`${hashSeed(seedSource)}:${metricName}`);
  const epochStartMs = options?.epochStartMs ?? (
    doc.timeline.start ? parseIsoMs(doc.timeline.start) : Date.now()
  );

  let arState = 0;
  let counterTotal = doc.counter?.startAt ?? 0;
  let tickIndex = 0;
  const episodeCache = new Map<string, ScheduledEpisode[]>();
  const shockByDay = new Map<string, number[]>();

  function shocksForDay(dayKey: string, dayStartMs: number, dayEndMs: number): number[] {
    let times = shockByDay.get(dayKey);
    if (times) return times;
    times = [];
    if (doc.shocks && doc.shocks.ratePerDay > 0) {
      const n = Math.max(0, Math.round(doc.shocks.ratePerDay));
      for (let i = 0; i < n; i += 1) {
        const u = uniformForKey(baseSeed, `shock:${metricName}:${dayKey}:${i}`);
        times.push(dayStartMs + u * (dayEndMs - dayStartMs));
      }
      times.sort((a, b) => a - b);
    }
    shockByDay.set(dayKey, times);
    return times;
  }

  function sample(tMs: number): number {
    const hour = localHour(tMs);
    const dayKey = utcDayKey(tMs);
    const dayIdx = dayIndexFromEpoch(tMs) - dayIndexFromEpoch(epochStartMs);
    const tickInHour = Math.floor(((tMs / 1000) % 3600) / freq);
    const currentTick = tickIndex;
    tickIndex += 1;

    if (doc.samplingKind === "counter") {
      if (currentTick > 0) {
        const incBand = doc.counter?.increment ?? { min: 1, max: 2 };
        const u = uniformForKey(baseSeed, `c:${metricName}:${currentTick}`);
        const inc = incBand.min + u * (incBand.max - incBand.min);
        counterTotal += Math.max(1e-9, inc);
      }
      return counterTotal;
    }

    let episodeBand: Band | undefined;
    for (let ei = 0; ei < (doc.episodes?.length ?? 0); ei += 1) {
      const episode = doc.episodes![ei];
      for (let wi = 0; wi < episode.windows.length; wi += 1) {
        const w = episode.windows[wi];
        if (!hourInWindow(hour, w.startHour, w.endHour)) continue;
        const cacheKey = `${ei}:${wi}:${dayKey}`;
        let schedules = episodeCache.get(cacheKey);
        if (!schedules) {
          schedules = scheduleEpisodesForDay(
            episode,
            wi,
            w.startHour,
            w.endHour,
            dayKey,
            freq,
            baseSeed
          );
          episodeCache.set(cacheKey, schedules);
        }
        const hourOffset =
          w.startHour <= w.endHour
            ? hour - w.startHour
            : hour >= w.startHour
              ? hour - w.startHour
              : hour + (24 - w.startHour);
        const tickInWindow =
          hourOffset * Math.ceil(3600 / freq) + tickInHour;
        const hit = episodeValueAt(schedules, tickInWindow);
        if (hit) {
          episodeBand = hit;
          break;
        }
      }
      if (episodeBand) break;
    }

    const band = activeBand(doc, tMs, hour) ?? doc.defaultBand ?? { min: 0, max: 1 };

    if (episodeBand) {
      return sampleInBand(
        episodeBand,
        uniformForKey(baseSeed, `ep:${metricName}:${currentTick}`),
        doc.noise
      );
    }

    if (hasProcess(doc)) {
      const mean = levelMean(doc);
      let seasonal = 0;
      if (doc.seasonality) {
        const periodSec = doc.seasonality.periodHours * 3600;
        const phaseSec = (doc.seasonality.phaseHours ?? 0) * 3600;
        const tau = ((tMs / 1000 + phaseSec) % periodSec) / periodSec;
        seasonal = doc.seasonality.amplitude * Math.sin(2 * Math.PI * tau);
      }
      let residual = 0;
      if (doc.residual) {
        const z = gaussianForKey(baseSeed, `res:${metricName}:${currentTick}`);
        if (doc.residual.type === "ar1") {
          const phi = doc.residual.phi ?? 0.8;
          arState = phi * arState + doc.residual.sigma * z;
          residual = arState;
        } else {
          residual = doc.residual.sigma * z;
        }
      }
      let shock = 0;
      if (doc.shocks) {
        const dayStart = Date.UTC(
          new Date(tMs).getUTCFullYear(),
          new Date(tMs).getUTCMonth(),
          new Date(tMs).getUTCDate()
        );
        const shockTimes = shocksForDay(dayKey, dayStart, dayStart + 86_400_000);
        for (let i = 0; i < shockTimes.length; i += 1) {
          const st = shockTimes[i];
          if (Math.abs(st - tMs) < stepMs) {
            if (doc.shocks.distribution === "student_t") {
              shock =
                doc.shocks.scale *
                Math.abs(studentTForKey(baseSeed, `sh:${metricName}:${dayKey}:${i}`, doc.shocks.df ?? 3));
            } else {
              shock =
                doc.shocks.scale *
                Math.abs(gaussianForKey(baseSeed, `sh:${metricName}:${dayKey}:${i}`));
            }
          }
        }
      }
      const windowNoise =
        doc.recurringWindows?.find((w) => hourInWindow(hour, w.startHour, w.endHour))?.noise ??
        doc.noise;
      const noiseJitter =
        noiseFraction(windowNoise) *
        (band.max - band.min) *
        (uniformForKey(baseSeed, `nj:${metricName}:${currentTick}`) - 0.5) *
        2;
      return clamp(mean + seasonal + residual + shock + noiseJitter, band.min, band.max);
    }

    const window = doc.recurringWindows?.find((w: RecurringWindow) =>
      hourInWindow(hour, w.startHour, w.endHour)
    );
    const u = uniformForKey(baseSeed, `g:${metricName}:${currentTick}`);
    let daily = 0;
    if (window?.dailyVariation) {
      daily =
        Math.sin((2 * Math.PI * dayIdx) / 7 + hour / 24) * 0.05 * (band.max - band.min);
    }
    return clamp(
      sampleInBand(band, u, window?.noise ?? doc.noise) + daily,
      band.min,
      band.max
    );
  }

  return {
    sample,
    get tickIndex() {
      return tickIndex;
    }
  };
}

function renderMetricWithSampler(
  doc: ConstraintDocument,
  metricName: string,
  startMs: number,
  stopMs: number,
  options?: { seedOverride?: string | number }
): SamplePoint[] {
  const stepMs = doc.timeline.frequencySeconds * 1000;
  const sampler = createMetricSampler(doc, metricName, {
    seedOverride: options?.seedOverride,
    epochStartMs: startMs
  });
  const samples: SamplePoint[] = [];
  for (let tMs = startMs; tMs < stopMs; tMs += stepMs) {
    samples.push({ tMs, value: sampler.sample(tMs) });
  }
  return samples;
}

/** Render all metrics in the constraint document (historic batch). */
export function renderConstraintDocument(
  doc: ConstraintDocument,
  options?: { seedOverride?: string | number }
): MetricSeries[] {
  if (!doc.timeline.start || !doc.timeline.stop) {
    throw new Error("timeline.start and timeline.stop are required for historic render");
  }
  const startMs = parseIsoMs(doc.timeline.start);
  const stopMs = parseIsoMs(doc.timeline.stop);
  if (stopMs <= startMs) {
    throw new Error("timeline.stop must be after timeline.start");
  }

  return doc.metrics.map((m) => ({
    metric: m.name,
    samples: renderMetricWithSampler(doc, m.name, startMs, stopMs, options)
  }));
}
