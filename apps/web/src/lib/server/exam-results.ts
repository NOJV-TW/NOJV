import { examDomain } from "@nojv/domain";

const { getExamSubmissionsMatrix } = examDomain;

export interface ExamResultProblemCol {
  id: string;
  letter: string;
  title: string;
  max: number;
}

export interface ExamResultRow {
  rank: number;
  user: string;
  sid: string;
  total: number;
  scores: number[];
  me: boolean;
}

export interface ExamResultBucket {
  label: string;
  count: number;
}

export interface ExamResultsData {
  problems: ExamResultProblemCol[];
  rows: ExamResultRow[];
  classAvg: number;
  median: number;
  max: number;
  min: number;
  submitted: number;
  total: number;
  buckets: ExamResultBucket[];
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

export async function buildResultsData(
  examId: string,
  viewerUserId: string,
): Promise<ExamResultsData> {
  const matrix = await getExamSubmissionsMatrix(examId);

  const problems: ExamResultProblemCol[] = matrix.problems.map((p) => ({
    id: p.problemId,
    letter: p.letter,
    title: p.title,
    max: p.points,
  }));

  // Sort by total desc; ties share rank.
  const sortedRows = [...matrix.rows].sort((a, b) => b.total - a.total);
  let lastTotal = -1;
  let lastRank = 0;
  const rows: ExamResultRow[] = sortedRows.map((r, idx) => {
    const rank = r.total === lastTotal ? lastRank : idx + 1;
    lastTotal = r.total;
    lastRank = rank;
    return {
      rank,
      user: r.displayName || r.handle || r.userId,
      sid: r.handle,
      total: r.total,
      scores: r.cells.map((c) => c.score ?? 0),
      me: r.userId === viewerUserId,
    };
  });

  const totals = rows.map((r) => r.total);
  const submitted = rows.filter((r) => r.total > 0).length;
  const total = matrix.studentCount;
  const classAvg =
    totals.length > 0 ? Math.round(totals.reduce((s, n) => s + n, 0) / totals.length) : 0;
  const med = median(totals);
  const max = totals.length > 0 ? Math.max(...totals) : 0;
  const min = totals.length > 0 ? Math.min(...totals) : 0;

  const buckets: ExamResultBucket[] = [
    { label: "90-100", count: 0 },
    { label: "80-89", count: 0 },
    { label: "70-79", count: 0 },
    { label: "60-69", count: 0 },
    { label: "<60", count: 0 },
  ];
  for (const t of totals) {
    let idx: number;
    if (t >= 90) idx = 0;
    else if (t >= 80) idx = 1;
    else if (t >= 70) idx = 2;
    else if (t >= 60) idx = 3;
    else idx = 4;
    const bucket = buckets[idx];
    if (bucket) bucket.count++;
  }

  return {
    problems,
    rows,
    classAvg,
    median: med,
    max,
    min,
    submitted,
    total,
    buckets,
  };
}
