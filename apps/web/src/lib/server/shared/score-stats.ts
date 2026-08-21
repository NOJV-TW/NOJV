export interface ScoreBucket {
  label: string;
  count: number;
}

export interface ScoreStats {
  buckets: ScoreBucket[];
  submitted: number;
  total: number;
  maxScore: number;
  classAvg: number;
  median: number;
  max: number;
  min: number;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return Math.round((a + b) / 2);
  }
  return sorted[mid] ?? 0;
}

export function buildScoreStats(
  scores: number[],
  studentCount: number,
  maxScore: number,
): ScoreStats {
  const totals = scores;
  const submitted = totals.filter((t) => t > 0).length;
  const classAvg =
    totals.length > 0 ? Math.round(totals.reduce((s, n) => s + n, 0) / totals.length) : 0;
  const med = median(totals);
  const max = totals.length > 0 ? Math.max(...totals) : 0;
  const min = totals.length > 0 ? Math.min(...totals) : 0;

  const rangeMax = max > 0 ? max : maxScore > 0 ? maxScore : 100;
  const thresholds = [90, 80, 70, 60].map((percent) => Math.ceil((rangeMax * percent) / 100));
  const buckets: ScoreBucket[] =
    rangeMax < 5
      ? Array.from({ length: rangeMax + 1 }, (_, index) => ({
          label: String(rangeMax - index),
          count: 0,
        }))
      : [
          { label: `${String(thresholds[0])}-${String(rangeMax)}`, count: 0 },
          { label: `${String(thresholds[1])}-${String((thresholds[0] ?? 1) - 1)}`, count: 0 },
          { label: `${String(thresholds[2])}-${String((thresholds[1] ?? 1) - 1)}`, count: 0 },
          { label: `${String(thresholds[3])}-${String((thresholds[2] ?? 1) - 1)}`, count: 0 },
          { label: `<${String(thresholds[3])}`, count: 0 },
        ];
  for (const t of totals) {
    let idx: number;
    if (rangeMax < 5) idx = rangeMax - t;
    else if (t >= (thresholds[0] ?? 0)) idx = 0;
    else if (t >= (thresholds[1] ?? 0)) idx = 1;
    else if (t >= (thresholds[2] ?? 0)) idx = 2;
    else if (t >= (thresholds[3] ?? 0)) idx = 3;
    else idx = 4;
    const bucket = buckets[idx];
    if (bucket) bucket.count++;
  }

  return {
    buckets,
    submitted,
    total: studentCount,
    maxScore,
    classAvg,
    median: med,
    max,
    min,
  };
}
