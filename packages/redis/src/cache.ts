import { getRedis } from "./connection";
import { keys } from "./keys";

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(keys.cache(key));
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await getRedis().set(keys.cache(key), JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(keys.cache(key));
}
