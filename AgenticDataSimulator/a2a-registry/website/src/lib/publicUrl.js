/** Normalize Astro/Vite BASE_URL and join with a relative asset path. */
export function publicUrl(path) {
  const raw = import.meta.env?.BASE_URL ?? '/';
  const root = raw.endsWith('/') ? raw : `${raw}/`;
  const rel = String(path).replace(/^\/+/, '');
  return `${root}${rel}`;
}

