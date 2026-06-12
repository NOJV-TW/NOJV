import type { PageLockedContext } from "@nojv/domain";

import type { ActiveExamContext } from "$lib/server/exam-lock";

export function createTtlCache<T>(ttlMs: number, maxEntries: number, nullTtlMs = ttlMs) {
  const store = new Map<string, { value: T; expiresAt: number }>();
  return {
    async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expiresAt > now) return hit.value;

      const value = await load();

      store.delete(key);
      if (store.size >= maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest != null) store.delete(oldest);
      }
      const ttl = (value as unknown) === null ? nullTtlMs : ttlMs;
      store.set(key, { value, expiresAt: now + ttl });
      return value;
    },
    invalidate(key: string): void {
      store.delete(key);
    },
  };
}

// Short TTL for `null`: caching "no active exam" across instances would skip the gate for a user who just started an exam elsewhere.
const NULL_CACHE_TTL_MS = 2_000;
export const pageLockCache = createTtlCache<PageLockedContext | null>(
  30_000,
  10_000,
  NULL_CACHE_TTL_MS,
);
export const examContextCache = createTtlCache<ActiveExamContext | null>(
  30_000,
  10_000,
  NULL_CACHE_TTL_MS,
);

export function invalidateExamContextCaches(userId: string): void {
  pageLockCache.invalidate(userId);
  examContextCache.invalidate(userId);
}
