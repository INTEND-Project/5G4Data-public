/**
 * Parses structured prefixes of synthetic observation prompts:
 * intent_id=…, mode=streaming|historic, frequency=Ns, optional start/stop, metric= slices.
 */

export type SyntheticMode = "streaming" | "historic";

export interface MetricSlice {
  metricCompound: string;
  instructionsText: string;
}

export interface ParsedSyntheticPrompt {
  intentId: string;
  mode: SyntheticMode;
  frequencySeconds: number;
  timezone?: string;
  historicStart?: Date;
  historicEnd?: Date;
  metricSlices: MetricSlice[];
  rawUserLine: string;
}

function stripWrappingQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Extract kv from `…` fragments and unquoted foo=bar tokens. */
export function extractKeyValueGlobals(text: string): Map<string, string> {
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

/** Canonical intent id: `I` + 32 lowercase hex (matches Controller / GraphDB ids). */
export function normalizeSyntheticIntentId(raw: string): string {
  const trimmed = raw.trim();
  if (/^I[a-f0-9]{32}$/iu.test(trimmed)) {
    return `I${trimmed.slice(1).toLowerCase()}`;
  }
  if (/^[a-f0-9]{32}$/iu.test(trimmed)) {
    return `I${trimmed.toLowerCase()}`;
  }
  return trimmed;
}

export function parseFrequencyToSeconds(fr: string): number | undefined {
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

/**
 * Parses `dd.mm.yyyy hh:mm:ss` or `dd.mm.yyyy hh.mm.ss` interpreted as UTC (see README).
 * Time separators may be colon or dot (matching date-style dotted notation).
 */
export function parseDdMmYyyyUtc(dateTimeStr: string): Date | undefined {
  const trimmed = stripWrappingQuotes(dateTimeStr);
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2})\s*[.:]\s*(\d{1,2})\s*[.:]\s*(\d{1,2})$/u.exec(
    trimmed
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
  )
    return undefined;
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(t);
  if (Number.isNaN(dt.valueOf())) return undefined;
  return dt;
}

const METRIC_RE = /\bmetric\s*=\s*((?:[^\s.`]+|`[^`]*`))(?!=)/gi;

function normalizedMetricCompound(raw: string): string {
  let s = stripWrappingQuotes(raw.trim());
  s = s.replace(/^`+|`+$/g, "");
  s = s.replace(/^metric\s*=\s*/iu, "").trim();
  return s.replace(/`/g, "");
}

interface MetricAnchor {
  compound: string;
  matchStart: number;
  bodyStart: number;
}

function findMetricAnchors(text: string): MetricAnchor[] {
  METRIC_RE.lastIndex = 0;
  const out: MetricAnchor[] = [];
  let m: RegExpExecArray | null;
  while ((m = METRIC_RE.exec(text)) !== null) {
    const raw = (m[1] ?? "").trim();
    const compound = normalizedMetricCompound(raw.replace(/^`|`$/g, ""));
    if (!compound) continue;
    out.push({
      compound,
      matchStart: m.index ?? 0,
      bodyStart: (m.index ?? 0) + (m[0]?.length ?? 0)
    });
  }
  return out;
}

export interface ParseSyntheticResult {
  ok: true;
  value: ParsedSyntheticPrompt;
}

export interface ParseSyntheticFailure {
  ok: false;
  error: string;
}

export type ParseSyntheticOutcome = ParseSyntheticResult | ParseSyntheticFailure;

export function parseSyntheticPrompt(userLine: string): ParseSyntheticOutcome {
  const rawUserLine = userLine.trim();
  if (!rawUserLine) return { ok: false, error: "Empty prompt." };

  const globals = extractKeyValueGlobals(rawUserLine);
  const intentIdRaw = globals.get("intent_id");
  const modeRaw = (globals.get("mode") ?? "").toLowerCase();
  const freqRaw = globals.get("frequency") ?? "";

  if (!intentIdRaw) return { ok: false, error: "Missing intent_id." };
  const intentId = normalizeSyntheticIntentId(intentIdRaw);

  const modeNorm = modeRaw.includes("streaming")
    ? "streaming"
    : modeRaw.includes("historic")
      ? "historic"
      : undefined;

  const frequencySeconds = parseFrequencyToSeconds(freqRaw);
  if (!modeNorm || (modeNorm !== "streaming" && modeNorm !== "historic")) {
    return { ok: false, error: "mode must be streaming or historic (e.g. `mode=streaming`)." };
  }
  if (frequencySeconds === undefined) {
    return { ok: false, error: "Missing or invalid frequency (e.g. `frequency=60s`)." };
  }

  const tz = globals.get("timezone");

  let historicStart: Date | undefined;
  let historicEnd: Date | undefined;
  const startRaw = globals.get("start");
  const stopRaw = globals.get("stop");

  if (modeNorm === "historic") {
    if (!startRaw || !stopRaw) {
      return {
        ok: false,
        error:
          "historic mode requires `start`/`stop` globals as `dd.mm.yyyy hh:mm:ss` or `dd.mm.yyyy hh.mm.ss` (UTC)."
      };
    }
    historicStart = parseDdMmYyyyUtc(startRaw);
    historicEnd = parseDdMmYyyyUtc(stopRaw);
    if (!historicStart || !historicEnd) {
      return {
        ok: false,
        error:
          "Could not parse start/stop timestamps. Use `dd.mm.yyyy hh:mm:ss` or `dd.mm.yyyy hh.mm.ss` (UTC)."
      };
    }
    if (historicEnd.getTime() <= historicStart.getTime()) {
      return { ok: false, error: "`stop` must be after `start`." };
    }
  }

  const anchors = findMetricAnchors(rawUserLine);
  if (anchors.length === 0) {
    return { ok: false, error: "No metric= clauses found (e.g. `metric=myprop_COabc...`)." };
  }

  const metricSlices: MetricSlice[] = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const bodyStart = anchors[i].bodyStart;
    const bodyEnd = i + 1 < anchors.length ? anchors[i + 1].matchStart : rawUserLine.length;
    const instructionsText = rawUserLine
      .slice(bodyStart, bodyEnd)
      .trim()
      .replace(/^[\s.,:]+/u, "")
      .trim();

    metricSlices.push({
      metricCompound: anchors[i].compound,
      instructionsText
    });
  }

  return {
    ok: true,
    value: {
      intentId,
      mode: modeNorm,
      frequencySeconds,
      timezone: tz,
      historicStart,
      historicEnd,
      metricSlices,
      rawUserLine
    }
  };
}

export function looksLikeSyntheticObservationPrompt(line: string): boolean {
  const g = extractKeyValueGlobals(line);
  return (
    Boolean(g.get("intent_id")) &&
    Boolean(g.get("frequency")) &&
    /\bmetric\s*=/iu.test(line) &&
    /streaming|historic/iu.test(g.get("mode") ?? "")
  );
}
