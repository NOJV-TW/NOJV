export interface Checkpoint {
  atMs: number;
  leadDays: number;
}

const GRACE_MS = 10 * 60_000;

export function computeReminderCheckpoints(
  targetMs: number,
  notBeforeMs: number,
  nowMs: number,
  maxLeadDays = 7,
): Checkpoint[] {
  const DAY = 86_400_000;
  const out: Checkpoint[] = [];
  for (let n = maxLeadDays; n >= 1; n--) {
    const at = targetMs - n * DAY;
    if (at < notBeforeMs) continue;
    if (at <= nowMs - GRACE_MS) continue;
    out.push({ atMs: at, leadDays: n });
  }
  return out;
}
