// Inside a workflow, `Date.now()` is Temporal's patched clock, so the timer is deterministic across replays.
export function computeAutoCloseDelayMs(endsAt: string, nowMs: number = Date.now()): number {
  return Math.max(0, new Date(endsAt).getTime() - nowMs);
}
