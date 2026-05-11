import { assessmentRepo, submissionRepo } from "@nojv/db";
import type { Language } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { resolveOverridesForContext } from "../scoring/resolve-final-score";

export type AssignmentDetailStatus = "draft" | "upcoming" | "open" | "closed";

export interface AssignmentDetailProblem {
  /** Stable problem id — used to link through to the problem page. */
  problemId: string;
  /** A, B, C, ... letter derived from `ordinal`. */
  letter: string;
  ordinal: number;
  displayId: number;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  /** Max points for this problem within this assignment. */
  points: number;
  // Null for managers OR when the assignment has no published problems.
  myStatus: {
    bestScore: number | null;
    attempts: number;
    lastSubmissionAt: string | null;
    /** `ac` = full score, `partial` = score > 0, `attempted` = score === 0, `none` = no subs */
    state: "ac" | "partial" | "attempted" | "none";
    /** True when the rendered bestScore came from a staff-set ScoreOverride. */
    overridden: boolean;
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
  title: string;
  summary: string;
  status: AssignmentDetailStatus;
  opensAt: string;
  dueAt: string | null;
  closesAt: string;
  maxAttemptsPerDay: number | null;
  allowedLanguages: Language[];
  totalPoints: number;
  problemCount: number;
  problems: AssignmentDetailProblem[];
  // Null for managers — teacher UI shows the per-problem matrix instead.
  myRecentSubmissions: AssignmentDetailSubmissionLogEntry[] | null;
}

export interface GetAssignmentDetailOptions {
  viewerUserId: string;
  isManager: boolean;
  now?: Date;
}

function letterFor(ordinal: number): string {
  if (ordinal < 1) return String(ordinal);
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
  now: Date,
): AssignmentDetailStatus {
  if (row.status === "draft") return "draft";
  if (row.opensAt > now) return "upcoming";
  if (row.closesAt < now) return "closed";
  return "open";
}

export async function getAssignmentDetail(
  courseId: string,
  assessmentId: string,
  options: GetAssignmentDetailOptions,
): Promise<AssignmentDetail> {
  const now = options.now ?? new Date();
  const row = await assessmentRepo.findDetailById(courseId, assessmentId);
  if (!row) throw new NotFoundError("Assignment not found.");

  const status = deriveStatus(row, now);

  // Draft assessments are author-facing only — surface as 404 to everyone else.
  if (!options.isManager && status === "draft") {
    throw new NotFoundError("Assignment not found.");
  }

  // Non-managers see problems only once the assessment has opened. Before
  // then (upcoming) we strip the list so neither the UI nor a downstream
  // caller can leak problem titles or link targets.
  const hideProblemsFromViewer = !options.isManager && status === "upcoming";

  const problems: AssignmentDetailProblem[] = hideProblemsFromViewer
    ? []
    : row.problems.map((p) => ({
        problemId: p.problem.id,
        ordinal: p.ordinal,
        letter: letterFor(p.ordinal),
        displayId: p.problem.displayId,
        title: p.problem.title,
        difficulty: p.problem.difficulty,
        points: p.points,
        myStatus: null,
      }));

  const totalPoints = hideProblemsFromViewer
    ? row.problems.reduce((sum, p) => sum + p.points, 0)
    : problems.reduce((sum, p) => sum + p.points, 0);

  let myRecentSubmissions: AssignmentDetailSubmissionLogEntry[] | null = null;

  if (!options.isManager && problems.length > 0) {
    // Best score + attempt count per problem for this student.
    const problemIds = problems.map((p) => p.problemId);
    const [grouped, recent] = await Promise.all([
      submissionRepo.groupByUserAndProblem({
        courseAssessmentId: assessmentId,
        userId: options.viewerUserId,
        problemId: { in: problemIds },
        sampleOnly: false,
      }),
      submissionRepo.findMany({
        where: {
          courseAssessmentId: assessmentId,
          userId: options.viewerUserId,
          sampleOnly: false,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          problemId: true,
          status: true,
          score: true,
          createdAt: true,
        },
      }),
    ]);

    const statsByProblem = new Map<string, { bestScore: number; attempts: number }>();
    for (const g of grouped) {
      statsByProblem.set(g.problemId, {
        bestScore: g._max.score ?? 0,
        attempts: g._count.id,
      });
    }

    const lastByProblem = new Map<string, string>();
    for (const s of recent) {
      if (!lastByProblem.has(s.problemId)) {
        lastByProblem.set(s.problemId, s.createdAt.toISOString());
      }
    }

    // Fetch overrides for this assignment (scoped to this viewer) and
    // let them win over the best-submission aggregate.
    const overrides = await resolveOverridesForContext({
      contextType: "assignment",
      contextId: assessmentId,
    });

    for (const problem of problems) {
      const stats = statsByProblem.get(problem.problemId);
      const overrideKey = `${options.viewerUserId}::${problem.problemId}`;
      const override = overrides.get(overrideKey);

      if (override !== undefined) {
        let state: "ac" | "partial" | "attempted" | "none" = "none";
        if (override >= problem.points) state = "ac";
        else if (override > 0) state = "partial";
        else if ((stats?.attempts ?? 0) > 0) state = "attempted";
        problem.myStatus = {
          bestScore: override,
          attempts: stats?.attempts ?? 0,
          lastSubmissionAt: lastByProblem.get(problem.problemId) ?? null,
          state,
          overridden: true,
        };
        continue;
      }

      if (!stats) {
        problem.myStatus = {
          bestScore: null,
          attempts: 0,
          lastSubmissionAt: null,
          state: "none",
          overridden: false,
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
        state,
        overridden: false,
      };
    }

    const problemLookup = new Map(
      problems.map((p) => [p.problemId, { letter: p.letter, title: p.title }]),
    );
    myRecentSubmissions = (
      recent as {
        id: string;
        problemId: string;
        status: string;
        score: number;
        createdAt: Date;
      }[]
    ).map((s) => {
      const p = problemLookup.get(s.problemId);
      return {
        id: s.id,
        problemId: s.problemId,
        problemLetter: p?.letter ?? "?",
        problemTitle: p?.title ?? "",
        status: s.status,
        score: s.score,
        createdAt: s.createdAt.toISOString(),
      };
    });
  }

  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    summary: row.summary,
    status,
    opensAt: row.opensAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    closesAt: row.closesAt.toISOString(),
    maxAttemptsPerDay: row.maxAttemptsPerDay,
    allowedLanguages: row.allowedLanguages,
    totalPoints,
    // The true count stays visible to upcoming-viewers — the UI uses it
    // to render "N problems will unlock when the assignment opens" — but
    // the `problems` array stays empty.
    problemCount: row.problems.length,
    problems,
    myRecentSubmissions,
  };
}
