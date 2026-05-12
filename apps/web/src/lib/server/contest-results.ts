export interface ContestResultBucket {
  label: string;
  count: number;
}

export interface ContestResultsData {
  buckets: ContestResultBucket[];
  submitted: number;
  total: number;
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

// Bucket participant scores into 5 percentage bands of `maxScore`. When
// `maxScore` is 0 (e.g. ICPC mode where score is solve count and we don't
// have a meaningful per-contest cap) we fall back to absolute totals.
export function buildContestResults(scores: number[], maxScore: number): ContestResultsData {
  const totals = scores;
  const total = totals.length;
  const submitted = totals.filter((t) => t > 0).length;
  const classAvg =
    totals.length > 0 ? Math.round(totals.reduce((s, n) => s + n, 0) / totals.length) : 0;
  const med = median(totals);
  const max = totals.length > 0 ? Math.max(...totals) : 0;
  const min = totals.length > 0 ? Math.min(...totals) : 0;

  const denom = maxScore > 0 ? maxScore : Math.max(max, 1);
  const buckets: ContestResultBucket[] = [
    { label: "90-100", count: 0 },
    { label: "80-89", count: 0 },
    { label: "70-79", count: 0 },
    { label: "60-69", count: 0 },
    { label: "<60", count: 0 },
  ];
  for (const t of totals) {
    const pct = (t / denom) * 100;
    let idx: number;
    if (pct >= 90) idx = 0;
    else if (pct >= 80) idx = 1;
    else if (pct >= 70) idx = 2;
    else if (pct >= 60) idx = 3;
    else idx = 4;
    const bucket = buckets[idx];
    if (bucket) bucket.count++;
  }

  return {
    buckets,
    submitted,
    total,
    classAvg,
    median: med,
    max,
    min,
  };
}
