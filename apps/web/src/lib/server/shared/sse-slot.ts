const MAX_SSE_PER_USER = 5;
const MAX_SSE_GLOBAL = 2000;

export type SseStreamType = "events" | "scoreboard";

const sseConnectionCounts = new Map<string, number>();
let globalCount = 0;

export function acquireSseSlot(streamType: SseStreamType, userId: string): boolean {
  if (globalCount >= MAX_SSE_GLOBAL) return false;
  const key = `${streamType}:${userId}`;
  const current = sseConnectionCounts.get(key) ?? 0;
  if (current >= MAX_SSE_PER_USER) return false;
  sseConnectionCounts.set(key, current + 1);
  globalCount++;
  return true;
}

export function releaseSseSlot(streamType: SseStreamType, userId: string): void {
  const key = `${streamType}:${userId}`;
  const current = sseConnectionCounts.get(key) ?? 0;
  if (current <= 1) {
    sseConnectionCounts.delete(key);
  } else {
    sseConnectionCounts.set(key, current - 1);
  }
  if (current > 0) globalCount = Math.max(0, globalCount - 1);
}
