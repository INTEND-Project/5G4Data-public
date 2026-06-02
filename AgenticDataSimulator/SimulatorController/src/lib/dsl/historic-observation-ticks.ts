/** Matches SimulatorAgentPackages default for `SYNTH_OBS_HISTORIC_MAX_POINTS`. */
export const DEFAULT_SYNTH_OBS_HISTORIC_MAX_POINTS = 250_000;

function stripWrappingQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Extract kv from `…` fragments and unquoted foo=bar tokens (aligned with agent syntheticPrompt). */
export function extractObservationInstructionGlobals(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const inner = stripWrappingQuotes(m[1]?.trim() ?? "");
    const eq = inner.indexOf("=");
    if (eq <= 0) continue;
    const k = inner.slice(0, eq).trim().toLowerCase();
    const v = inner.slice(eq + 1).trim();
    if (k && v) out.set(k, v);
  }
  for (const m of text.matchAll(/\b([a-z][a-z0-9_]*)\s*=\s*([^`=\s]+(?:\([^)]*\))?)/gi)) {
    const k = (m[1] ?? "").toLowerCase();
    const rawV = stripWrappingQuotes((m[2] ?? "").trim());
    if (!k || !rawV || out.has(k)) continue;
    out.set(k, rawV.replace(/[`]+$/u, ""));
  }
  return out;
}

export function parseObservationFrequencyToSeconds(fr: string): number | undefined {
  const s = fr.trim().toLowerCase().replace(/^=/, "");
  const mSec = /^(\d+(?:\.\d+)?)s$/i.exec(s);
  if (mSec) {
    const n = Number(mSec[1]);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : undefined;
  }
  const mMin = /^(\d+(?:\.\d+)?)m$/i.exec(s);
  if (mMin) {
    const n = Number(mMin[1]);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n * 60)) : undefined;
  }
  const mHour = /^(\d+(?:\.\d+)?)h$/i.exec(s);
  if (mHour) {
    const n = Number(mHour[1]);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n * 3600)) : undefined;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return Math.max(1, Math.round(n));
  return undefined;
}

/** Parses `dd.mm.yyyy hh:mm:ss` or `dd.mm.yyyy hh.mm.ss` as UTC (agent convention). */
export function parseObservationDdMmYyyyUtc(dateTimeStr: string): Date | undefined {
  const trimmed = stripWrappingQuotes(dateTimeStr);
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2})\s*[.:]\s*(\d{1,2})\s*[.:]\s*(\d{1,2})$/u.exec(
    trimmed,
  );
  if (!m) return undefined;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  if (
    ![d, mo, y, h, mi, s].every((x) => Number.isFinite(x)) ||
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > 31
  ) {
    return undefined;
  }
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(t);
  if (Number.isNaN(dt.valueOf())) return undefined;
  return dt;
}

export type ParsedHistoricObservationWindow = {
  frequencySeconds: number;
  start: Date;
  stop: Date;
  tickCount: number;
};

export function parseHistoricObservationWindow(
  instructions: string,
): ParsedHistoricObservationWindow | null {
  const globals = extractObservationInstructionGlobals(instructions);
  const modeRaw = (globals.get("mode") ?? "").toLowerCase();
  if (!modeRaw.includes("historic")) {
    return null;
  }

  const frequencySeconds = parseObservationFrequencyToSeconds(globals.get("frequency") ?? "");
  const startRaw = globals.get("start");
  const stopRaw = globals.get("stop");
  if (!frequencySeconds || !startRaw || !stopRaw) {
    return null;
  }

  const start = parseObservationDdMmYyyyUtc(startRaw);
  const stop = parseObservationDdMmYyyyUtc(stopRaw);
  if (!start || !stop || stop.getTime() <= start.getTime()) {
    return null;
  }

  const freqMs = Math.max(1, frequencySeconds) * 1000;
  const tickCount = Math.floor((stop.getTime() - start.getTime()) / freqMs) + 1;
  if (!Number.isFinite(tickCount) || tickCount < 1) {
    return null;
  }

  return { frequencySeconds, start, stop, tickCount };
}

export function readSynthObsHistoricMaxPoints(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.SYNTH_OBS_HISTORIC_MAX_POINTS?.trim();
  if (!raw) return DEFAULT_SYNTH_OBS_HISTORIC_MAX_POINTS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SYNTH_OBS_HISTORIC_MAX_POINTS;
  return Math.floor(parsed);
}

export const DEFAULT_SYNTH_OBS_PROM_FLUSH_CHUNK = 10_000;

export function readSynthObsPromFlushChunk(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.SYNTH_OBS_PROM_FLUSH_CHUNK?.trim();
  if (!raw) return DEFAULT_SYNTH_OBS_PROM_FLUSH_CHUNK;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SYNTH_OBS_PROM_FLUSH_CHUNK;
  return Math.floor(parsed);
}

export function formatHistoricObservationRunHint(
  window: ParsedHistoricObservationWindow,
  storage: "prometheus" | "graphdb" | null | undefined,
): string {
  const tickLabel = window.tickCount.toLocaleString("en-US");
  if (storage !== "prometheus") {
    return `Historic observation will generate about ${tickLabel} ticks (frequency ${window.frequencySeconds}s).`;
  }
  const chunk = readSynthObsPromFlushChunk();
  if (chunk <= 0) {
    return (
      `Historic Prometheus observation will generate about ${tickLabel} ticks; ` +
      "samples are remote-written once at the end (SYNTH_OBS_PROM_FLUSH_CHUNK=0)."
    );
  }
  return (
    `Historic Prometheus observation will generate about ${tickLabel} ticks; ` +
    `remote-write flushes every ${chunk.toLocaleString("en-US")} samples so intents can turn green incrementally.`
  );
}

export function formatHistoricTickCapExceededMessage(
  window: ParsedHistoricObservationWindow,
  maxPoints: number,
): string {
  const startLabel = window.start.toISOString().replace(/\.\d{3}Z$/u, "Z");
  const stopLabel = window.stop.toISOString().replace(/\.\d{3}Z$/u, "Z");
  return (
    `Historic observation would generate ${window.tickCount.toLocaleString("en-US")} ticks ` +
    `(start ${startLabel}, stop ${stopLabel}, frequency ${window.frequencySeconds}s), ` +
    `exceeding SYNTH_OBS_HISTORIC_MAX_POINTS (${maxPoints.toLocaleString("en-US")}). ` +
    "Shorten the start/stop window or increase frequency (e.g. 360s)."
  );
}
