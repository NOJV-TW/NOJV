import type { courseDomain } from "@nojv/domain";

export interface AssignmentResultBucket {
  label: string;
  count: number;
}

export interface AssignmentResultsData {
  buckets: AssignmentResultBucket[];
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

// Buckets per-student totals (already aggregated by buildSubmissionsMatrix) into
// 90+, 80-89, 70-79, 60-69, <60 bands of the assignment's totalPoints scale.
// `matrix.totalPoints` may be 0 when no problems are configured — in that case
// every student is bucketed by absolute score (which will all be 0).
export function buildAssignmentResults(
  matrix: courseDomain.SubmissionsMatrix,
): AssignmentResultsData {
  const totals = matrix.rows.map((r) => r.total);
  const total = matrix.studentCount;
  const submitted = totals.filter((t) => t > 0).length;
  const classAvg =
    totals.length > 0 ? Math.round(totals.reduce((s, n) => s + n, 0) / totals.length) : 0;
  const med = median(totals);
  const max = totals.length > 0 ? Math.max(...totals) : 0;
  const min = totals.length > 0 ? Math.min(...totals) : 0;

  const maxScore = matrix.totalPoints > 0 ? matrix.totalPoints : 100;
  const buckets: AssignmentResultBucket[] = [
    { label: "90-100", count: 0 },
    { label: "80-89", count: 0 },
    { label: "70-79", count: 0 },
    { label: "60-69", count: 0 },
    { label: "<60", count: 0 },
  ];
  for (const t of totals) {
    const pct = (t / maxScore) * 100;
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
