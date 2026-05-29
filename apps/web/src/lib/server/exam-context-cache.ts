import type { PageLockedContext } from "@nojv/domain";

import type { ActiveExamContext } from "$lib/server/exam-lock";

export function createTtlCache<T>(ttlMs: number, maxEntries: number) {
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
      store.set(key, { value, expiresAt: now + ttlMs });
      return value;
    },
    invalidate(key: string): void {
      store.delete(key);
    },
  };
}

export const pageLockCache = createTtlCache<PageLockedContext | null>(30_000, 10_000);
export const examContextCache = createTtlCache<ActiveExamContext | null>(30_000, 10_000);

export function invalidateExamContextCaches(userId: string): void {
  pageLockCache.invalidate(userId);
  examContextCache.invalidate(userId);
}
