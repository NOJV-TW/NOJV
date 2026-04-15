import { assessmentRepo, submissionRepo } from "@nojv/db";

import { NotFoundError } from "../shared/errors";

/**
 * Assignment detail shape consumed by the per-assignment page
 * (prototypes 06 + 07). Shared between the student view and the
 * teacher sub-tabs — which fields are populated depends on the
 * `isManager` flag passed to `getAssignmentDetail`.
 */
export type AssignmentDetailStatus = "draft" | "upcoming" | "open" | "closed";

export interface AssignmentDetailProblem {
  /** Stable problem id — used to link through to the problem page. */
  problemId: string;
  /** A, B, C, ... letter derived from `ordinal`. */
  letter: string;
  ordinal: number;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  /** Max points for this problem within this assignment. */
  points: number;
  /**
   * Student-facing personal stats. Null when the viewer is a manager
   * (teacher/TA) OR when the assignment has no published problems yet.
   */
  myStatus: {
    bestScore: number | null;
    attempts: number;
    lastSubmissionAt: string | null;
    /** `ac` = full score, `partial` = score > 0, `attempted` = score === 0, `none` = no subs */
    state: "ac" | "partial" | "attempted" | "none";
  } | null;
}

export interface AssignmentDetailSubmissionLogEntry {
  id: string;
  problemId: string;
  problemLetter: string;
  problemTitle: string;
  status: string;
  score: number;
  createdAt: string;
}

export interface AssignmentDetail {
  id: string;
  courseId: string;
  slug: string;
  title: string;
  summary: string;
  status: AssignmentDetailStatus;
  opensAt: string;
  dueAt: string | null;
  closesAt: string;
  maxAttemptsPerDay: number | null;
  allowedLanguages: string[];
  totalPoints: number;
  problemCount: number;
  problems: AssignmentDetailProblem[];
  /**
   * Compact submission log for the student view (last 10). Null for the
   * teacher view — the manager UI shows the per-problem matrix instead.
   */
  myRecentSubmissions: AssignmentDetailSubmissionLogEntry[] | null;
}

export interface GetAssignmentDetailOptions {
  viewerUserId: string;
  isManager: boolean;
  now?: Date;
}

function letterFor(ordinal: number): string {
  if (ordinal < 1) return String(ordinal);
  // A = ordinal 1. Past Z (ordinal 26) wraps to AA / AB / ... which is
  // fine for the rare >26-problem case — Excel-style column labels.
  let n = ordinal;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function deriveStatus(
  row: { status: string; opensAt: Date; closesAt: Date },
  now: Date
): AssignmentDetailStatus {
  if (row.status === "draft") return "draft";
  if (row.opensAt > now) return "upcoming";
  if (row.closesAt < now) return "closed";
  return "open";
}

/**
 * Load the full assignment detail shape for the per-assignment page.
 * Scoped to a course id so the caller (loader) is guaranteed ownership
 * alignment with its parent layout data.
 *
 * For student viewers this also issues two extra reads: a
 * `groupByUserAndProblem` for best-score/attempt stats across all
 * problems in the assignment, and a recent-submissions log capped at
 * 10 entries. For manager viewers both extras are skipped — the
 * teacher view pivots into the submissions matrix instead.
 */
export async function getAssignmentDetail(
  courseId: string,
  assessmentId: string,
  options: GetAssignmentDetailOptions
): Promise<AssignmentDetail> {
  const now = options.now ?? new Date();
  const row = await assessmentRepo.findDetailById(courseId, assessmentId);
  if (!row) throw new NotFoundError("Assignment not found.");

  const problems: AssignmentDetailProblem[] = row.problems.map((p) => ({
    problemId: p.problem.id,
    ordinal: p.ordinal,
    letter: letterFor(p.ordinal),
    title: p.problem.title,
    difficulty: p.problem.difficulty as "easy" | "medium" | "hard",
    points: p.points,
    myStatus: null
  }));

  const totalPoints = problems.reduce((sum, p) => sum + p.points, 0);

  const status = deriveStatus(row, now);

  let myRecentSubmissions: AssignmentDetailSubmissionLogEntry[] | null = null;

  if (!options.isManager && problems.length > 0) {
    // Best score + attempt count per problem for this student.
    const problemIds = problems.map((p) => p.problemId);
    const [grouped, recent] = await Promise.all([
      submissionRepo.groupByUserAndProblem({
        courseAssessmentId: assessmentId,
        userId: options.viewerUserId,
        problemId: { in: problemIds },
        sampleOnly: false
      }),
      submissionRepo.findMany({
        where: {
          courseAssessmentId: assessmentId,
          userId: options.viewerUserId,
          sampleOnly: false
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          problemId: true,
          status: true,
          score: true,
          createdAt: true
        }
      })
    ]);

    const statsByProblem = new Map<
      string,
      { bestScore: number; attempts: number }
    >();
    for (const g of grouped) {
      statsByProblem.set(g.problemId, {
        bestScore: g._max.score ?? 0,
        attempts: g._count.id
      });
    }

    // Per-problem last submission timestamp (cheap: scan the recent log first,
    // fall back to a targeted `findFirst` only if the student has more than
    // 10 submissions AND we're missing a problem). The `recent` log is
    // normally sufficient for the student view's meta line.
    const lastByProblem = new Map<string, string>();
    for (const s of recent) {
      if (!lastByProblem.has(s.problemId)) {
        lastByProblem.set(s.problemId, s.createdAt.toISOString());
      }
    }

    for (const problem of problems) {
      const stats = statsByProblem.get(problem.problemId);
      if (!stats) {
        problem.myStatus = {
          bestScore: null,
          attempts: 0,
          lastSubmissionAt: null,
          state: "none"
        };
        continue;
      }
      let state: "ac" | "partial" | "attempted" | "none" = "none";
      if (stats.bestScore >= problem.points) state = "ac";
      else if (stats.bestScore > 0) state = "partial";
      else if (stats.attempts > 0) state = "attempted";
      problem.myStatus = {
        bestScore: stats.bestScore,
        attempts: stats.attempts,
        lastSubmissionAt: lastByProblem.get(problem.problemId) ?? null,
        state
      };
    }

    const problemLookup = new Map(
      problems.map((p) => [p.problemId, { letter: p.letter, title: p.title }])
    );
    myRecentSubmissions = (recent as Array<{
      id: string;
      problemId: string;
      status: string;
      score: number;
      createdAt: Date;
    }>).map((s) => {
      const p = problemLookup.get(s.problemId);
      return {
        id: s.id,
        problemId: s.problemId,
        problemLetter: p?.letter ?? "?",
        problemTitle: p?.title ?? "",
        status: s.status,
        score: s.score,
        createdAt: s.createdAt.toISOString()
      };
    });
  }

  return {
    id: row.id,
    courseId: row.courseId,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    status,
    opensAt: row.opensAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    closesAt: row.closesAt.toISOString(),
    maxAttemptsPerDay: row.maxAttemptsPerDay,
    allowedLanguages: row.allowedLanguages as string[],
    totalPoints,
    problemCount: problems.length,
    problems,
    myRecentSubmissions
  };
}
