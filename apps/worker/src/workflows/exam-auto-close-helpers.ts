export function computeAutoCloseDelayMs(endsAt: string, nowMs: number = Date.now()): number {
  return Math.max(0, new Date(endsAt).getTime() - nowMs);
}
