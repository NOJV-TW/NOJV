export interface ActivityEvent {
  at: string;
  ac: boolean;
}

export interface ActivityDay {
  date: string;
  acCount: number;
  submissionCount: number;
}

export interface ActivityModel {
  heatmapDays: ActivityDay[];
  weeklyTrend: ActivityDay[];
  streakDays: number;
}

function localDayKey(d: Date): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface DayBucket {
  acCount: number;
  submissionCount: number;
}

function bucketByLocalDay(events: ActivityEvent[]): Map<string, DayBucket> {
  const byDay = new Map<string, DayBucket>();
  for (const e of events) {
    const key = localDayKey(new Date(e.at));
    const bucket = byDay.get(key) ?? { acCount: 0, submissionCount: 0 };
    bucket.submissionCount += 1;
    if (e.ac) bucket.acCount += 1;
    byDay.set(key, bucket);
  }
  return byDay;
}

function computeStreak(byDay: Map<string, DayBucket>, todayStart: Date): number {
  const acOn = (d: Date) => (byDay.get(localDayKey(d))?.acCount ?? 0) > 0;
  const prevDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);

  let cursor: Date;
  if (acOn(todayStart)) cursor = todayStart;
  else if (acOn(prevDay(todayStart))) cursor = prevDay(todayStart);
  else return 0;

  let streak = 0;
  while (acOn(cursor)) {
    streak += 1;
    cursor = prevDay(cursor);
  }
  return streak;
}

export function buildActivityModel(
  events: ActivityEvent[],
  now: Date,
  windowDays: number,
): ActivityModel {
  const byDay = bucketByLocalDay(events);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const heatmapDays: ActivityDay[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(
      todayStart.getFullYear(),
      todayStart.getMonth(),
      todayStart.getDate() - i,
    );
    const bucket = byDay.get(localDayKey(d));
    heatmapDays.push({
      date: localDayKey(d),
      acCount: bucket?.acCount ?? 0,
      submissionCount: bucket?.submissionCount ?? 0,
    });
  }

  return {
    heatmapDays,
    weeklyTrend: heatmapDays.slice(-7),
    streakDays: computeStreak(byDay, todayStart),
  };
}
