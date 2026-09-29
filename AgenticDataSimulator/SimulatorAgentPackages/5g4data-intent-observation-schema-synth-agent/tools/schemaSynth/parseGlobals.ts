/** Timeline / instruction globals helpers (Controller DSL backtick tokens). */

export interface InstructionGlobals {
  mode?: "historic" | "streaming";
  start?: string;
  stop?: string;
  frequencySeconds?: number;
  metrics: string[];
  /** Instructions with backtick globals removed (prose for LLM). */
  prose: string;
}

function parseFrequencySeconds(raw: string): number | undefined {
  const m = raw.trim().match(/^(\d+)\s*s$/i);
  if (m) return Number(m[1]);
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Convert `dd.mm.yyyy hh:mm:ss` (UTC) to ISO if needed. */
export function dslDateToIso(raw: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    return t.includes("T") ? t : t.replace(" ", "T") + (t.endsWith("Z") ? "" : "Z");
  }
  const m = t.match(
    /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2})[:.](\d{2})[:.](\d{2})$/
  );
  if (!m) return t;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
}

export function extractInstructionGlobals(instructions: string): InstructionGlobals {
  const metrics: string[] = [];
  let mode: "historic" | "streaming" | undefined;
  let start: string | undefined;
  let stop: string | undefined;
  let frequencySeconds: number | undefined;

  // Only match balanced `key=value` tokens so an orphan tick cannot swallow later globals.
  const backtickRe = /`([a-zA-Z_][\w]*=[^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRe.exec(instructions)) !== null) {
    const token = match[1].trim();
    const eq = token.indexOf("=");
    if (eq <= 0) continue;
    const key = token.slice(0, eq).trim().toLowerCase();
    const value = token.slice(eq + 1).trim();
    if (key === "mode" && (value === "historic" || value === "streaming")) {
      mode = value;
    } else if (key === "start") {
      start = value;
    } else if (key === "stop") {
      stop = value;
    } else if (key === "frequency") {
      frequencySeconds = parseFrequencySeconds(value);
    } else if (key === "metric") {
      metrics.push(value);
    }
  }

  const prose = instructions
    // Only strip balanced `key=value` tokens — never pair an orphan tick with later prose.
    .replace(/`([a-zA-Z_][\w]*=[^`]*)`/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { mode, start, stop, frequencySeconds, metrics, prose };
}
