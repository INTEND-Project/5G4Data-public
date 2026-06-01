/** Server-side lite intent list cache (isolated so client components can invalidate without importing Prometheus). */

export const LITE_LIST_CACHE_TTL_MS = 15_000;

type LiteListCacheEntry = {
  expiresAt: number;
  intents: unknown[];
};

const liteListCache = new Map<string, LiteListCacheEntry>();

export function invalidateLiteListCache(): void {
  liteListCache.clear();
}

export function getLiteListCacheEntry(
  cacheKey: string,
  nowMs = Date.now(),
): LiteListCacheEntry | undefined {
  const cached = liteListCache.get(cacheKey);
  if (!cached || cached.expiresAt <= nowMs) {
    return undefined;
  }
  return cached;
}

export function setLiteListCacheEntry(cacheKey: string, intents: unknown[]): void {
  liteListCache.set(cacheKey, {
    expiresAt: Date.now() + LITE_LIST_CACHE_TTL_MS,
    intents,
  });
}
