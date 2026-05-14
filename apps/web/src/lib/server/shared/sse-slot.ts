// Per-user concurrent SSE connection cap. The single 5-connection ceiling
// is shared across stream types so a client opening five submission
// streams cannot also open five event streams in parallel. The previous
// per-endpoint Maps let a client multiply the cap by the number of
// endpoints; this collapses them back into one counter per user.

const MAX_SSE_PER_USER = 5;

export type SseStreamType = "submission" | "events";

const sseConnectionCounts = new Map<string, number>();

export function acquireSseSlot(_streamType: SseStreamType, userId: string): boolean {
  const current = sseConnectionCounts.get(userId) ?? 0;
  if (current >= MAX_SSE_PER_USER) return false;
  sseConnectionCounts.set(userId, current + 1);
  return true;
}

export function releaseSseSlot(_streamType: SseStreamType, userId: string): void {
  const current = sseConnectionCounts.get(userId) ?? 0;
  if (current <= 1) {
    sseConnectionCounts.delete(userId);
  } else {
    sseConnectionCounts.set(userId, current - 1);
  }
}
