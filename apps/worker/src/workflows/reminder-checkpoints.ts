export interface Checkpoint {
  atMs: number;
  leadDays: number;
}

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
    if (at <= nowMs) continue;
    out.push({ atMs: at, leadDays: n });
  }
  return out;
}
