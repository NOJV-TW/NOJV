import type { ZodType } from "zod";

import { getRedis } from "./connection";
import { keys } from "./keys";

/**
 * Read a cached value and validate it against the provided Zod schema.
 *
 * Callers MUST pass a schema so that shape drift (e.g. after a migration)
 * surfaces as a parse failure instead of silently propagating wrongly-typed
 * data to consumers. On parse failure this throws — corruption is not hidden.
 */
export async function cacheGet<T>(key: string, schema: ZodType<T>): Promise<T | null> {
  const raw = await getRedis().get(keys.cache(key));
  if (!raw) return null;
  return schema.parse(JSON.parse(raw));
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await getRedis().set(keys.cache(key), JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(keys.cache(key));
}
