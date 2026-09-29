/** Deterministic PRNG helpers (mulberry32 + hash). */

export function hashSeed(input: string | number): number {
  const s = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function uniformForKey(baseSeed: number, key: string): number {
  return mulberry32(hashSeed(`${baseSeed}:${key}`))();
}

/** Box-Muller using two uniforms from a key. */
export function gaussianForKey(baseSeed: number, key: string): number {
  const u1 = Math.max(1e-12, uniformForKey(baseSeed, `${key}:u1`));
  const u2 = uniformForKey(baseSeed, `${key}:u2`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function studentTForKey(baseSeed: number, key: string, df: number): number {
  const z = gaussianForKey(baseSeed, `${key}:z`);
  // Approximate chi2(df)/df via sum of squared gaussians
  let acc = 0;
  for (let i = 0; i < Math.max(1, Math.floor(df)); i += 1) {
    const g = gaussianForKey(baseSeed, `${key}:c${i}`);
    acc += g * g;
  }
  const v = acc / Math.max(1, df);
  return z / Math.sqrt(Math.max(1e-12, v));
}
