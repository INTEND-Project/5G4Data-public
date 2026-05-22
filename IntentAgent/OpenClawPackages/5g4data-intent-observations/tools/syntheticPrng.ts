export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parse `UTC+2`, `+02:00`, or `-05:30` into signed offset minutes (default 0). */
export function parseUtcOffsetMinutes(hint?: string): number {
  const t = hint?.trim();
  if (!t) return 0;

  const utcMatch = /^utc?\s*([+-])\s*(\d{1,2})(?::(\d{2}))?$/iu.exec(t);
  const plainMatch = utcMatch ?? /^([+-])\s*(\d{1,2})(?::(\d{2}))?$/u.exec(t);
  if (!plainMatch) return 0;

  const sign = plainMatch[1] === "-" ? -1 : 1;
  const hours = Number(plainMatch[2]);
  const minutes = Number(plainMatch[3] ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return sign * (hours * 60 + minutes);
}

export function localHourFromSim(simTime: Date, utcOffsetMinutes: number): number {
  const totalMinutes = simTime.getUTCHours() * 60 + simTime.getUTCMinutes() + utcOffsetMinutes;
  return ((Math.floor(totalMinutes / 60) % 24) + 24) % 24;
}
