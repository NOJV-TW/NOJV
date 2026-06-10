const MAX_SSE_PER_USER = 5;
const MAX_SSE_GLOBAL = 2000;

export type SseStreamType = "submission" | "events";

const sseConnectionCounts = new Map<string, number>();
let globalCount = 0;

export function acquireSseSlot(_streamType: SseStreamType, userId: string): boolean {
  if (globalCount >= MAX_SSE_GLOBAL) return false;
  const current = sseConnectionCounts.get(userId) ?? 0;
  if (current >= MAX_SSE_PER_USER) return false;
  sseConnectionCounts.set(userId, current + 1);
  globalCount++;
  return true;
}

export function releaseSseSlot(_streamType: SseStreamType, userId: string): void {
  const current = sseConnectionCounts.get(userId) ?? 0;
  if (current <= 1) {
    sseConnectionCounts.delete(userId);
  } else {
    sseConnectionCounts.set(userId, current - 1);
  }
  if (current > 0) globalCount = Math.max(0, globalCount - 1);
}
