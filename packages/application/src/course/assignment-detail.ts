import { assessmentAuditLogRepo, assessmentRepo, submissionRepo } from "@nojv/db";
import { adjustmentRulesSchema, type AdjustmentRule, type Language } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { getOverridesForContext } from "../scoring/resolve-final-score";
import { getProblemTotalScores } from "../problem/total-score";

function extractLatePenalty(raw: unknown): AdjustmentRule | null {
  const parsed = adjustmentRulesSchema.safeParse(raw);
  if (!parsed.success) return null;
  return (
    parsed.data.find(
      (r) =>
        r.type === "flat_late_penalty" ||
        r.type === "daily_late_penalty" ||
        r.type === "final_day_zero",
    ) ?? null
  );
}

export type AssignmentDetailStatus = "draft" | "upcoming" | "open" | "closed";

type ProblemSolveState = "ac" | "partial" | "attempted" | "none";

export interface AssignmentDetailProblem {
  problemId: string;
  letter: string;
  ordinal: number;
  displayId: number;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  points: number;
  myStatus: {
    bestScore: number | null;
    attempts: number;
    lastSubmissionAt: string | null;
    state: ProblemSolveState;
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
  maxScore: number | null;
  createdAt: string;
}

export interface AssessmentAuditEntry {
  action: "publish" | "revert_to_draft" | "delete_draft";
  actorName: string | null;
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
  attemptResetMinuteOfDay: number | null;
  allowedLanguages: Language[];
  latePenalty: AdjustmentRule | null;
  totalPoints: number;
  problemCount: number;
  problems: AssignmentDetailProblem[];
  myRecentSubmissions: AssignmentDetailSubmissionLogEntry[] | null;
  auditLog: AssessmentAuditEntry[];
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
    label = String.fromCodePoint(65 + rem) + label;
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

interface ProblemStats {
  bestScore: number;
  attempts: number;
}

function resolveProblemStatus(
  problem: AssignmentDetailProblem,
  stats: ProblemStats | undefined,
  override: number | undefined,
  lastSubmissionAt: string | null,
): AssignmentDetailProblem["myStatus"] {
  if (override !== undefined) {
    let state: ProblemSolveState = "none";
    if (override >= problem.points) state = "ac";
    else if (override > 0) state = "partial";
    else if ((stats?.attempts ?? 0) > 0) state = "attempted";
    return {
      bestScore: override,
      attempts: stats?.attempts ?? 0,
      lastSubmissionAt,
      state,
      overridden: true,
    };
  }

  if (!stats) {
    return {
      bestScore: null,
      attempts: 0,
      lastSubmissionAt: null,
      state: "none",
      overridden: false,
    };
  }

  let state: ProblemSolveState = "none";
  if (stats.bestScore >= problem.points) state = "ac";
  else if (stats.bestScore > 0) state = "partial";
  else if (stats.attempts > 0) state = "attempted";
  return {
    bestScore: stats.bestScore,
    attempts: stats.attempts,
    lastSubmissionAt,
    state,
    overridden: false,
  };
}

function buildRecentSubmissionLog(
  recent: {
    id: string;
    problemId: string;
    status: string;
    score: number;
    createdAt: Date;
  }[],
  problems: AssignmentDetailProblem[],
): AssignmentDetailSubmissionLogEntry[] {
  const problemLookup = new Map(
    problems.map((p) => [p.problemId, { letter: p.letter, title: p.title, points: p.points }]),
  );
  return recent.map((s) => {
    const p = problemLookup.get(s.problemId);
    return {
      id: s.id,
      problemId: s.problemId,
      problemLetter: p?.letter ?? "?",
      problemTitle: p?.title ?? "",
      status: s.status,
      score: s.score,
      maxScore: p?.points ?? null,
      createdAt: s.createdAt.toISOString(),
    };
  });
}

export async function getAssignmentDetail(
  courseId: string,
  assignmentId: string,
  options: GetAssignmentDetailOptions,
): Promise<AssignmentDetail> {
  const now = options.now ?? new Date();
  const row = await assessmentRepo.findDetailById(courseId, assignmentId);
  if (!row) throw new NotFoundError("Assignment not found.");

  const status = deriveStatus(row, now);

  if (!options.isManager && status === "draft") {
    throw new NotFoundError("Assignment not found.");
  }

  const hideProblemsFromViewer = !options.isManager && status === "upcoming";

  const maxByProblem = await getProblemTotalScores(row.problems.map((p) => p.problem.id));
  const maxFor = (p: (typeof row.problems)[number]) =>
    maxByProblem.get(p.problem.id) ?? p.points;

  const problems: AssignmentDetailProblem[] = hideProblemsFromViewer
    ? []
    : row.problems.map((p) => ({
        problemId: p.problem.id,
        ordinal: p.ordinal,
        letter: letterFor(p.ordinal),
        displayId: p.problem.displayId,
        title: p.problem.title,
        difficulty: p.problem.difficulty,
        points: maxFor(p),
        myStatus: null,
      }));

  const totalPoints = row.problems.reduce((sum, p) => sum + maxFor(p), 0);

  let myRecentSubmissions: AssignmentDetailSubmissionLogEntry[] | null = null;

  if (!options.isManager && problems.length > 0) {
    const problemIds = problems.map((p) => p.problemId);
    const [grouped, recent] = await Promise.all([
      submissionRepo.groupByUserAndProblem({
        assessmentId: assignmentId,
        userId: options.viewerUserId,
        problemId: { in: problemIds },
        sampleOnly: false,
      }),
      submissionRepo.findMany({
        where: {
          assessmentId: assignmentId,
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

    const overrides = await getOverridesForContext({
      type: "assignment",
      assignmentId,
    });

    for (const problem of problems) {
      const stats = statsByProblem.get(problem.problemId);
      const overrideKey = `${options.viewerUserId}::${problem.problemId}`;
      const override = overrides.get(overrideKey);
      problem.myStatus = resolveProblemStatus(
        problem,
        stats,
        override,
        lastByProblem.get(problem.problemId) ?? null,
      );
    }

    myRecentSubmissions = buildRecentSubmissionLog(recent, problems);
  }

  const auditRows = options.isManager
    ? await assessmentAuditLogRepo.listByAssessment(row.id)
    : [];
  const auditLog: AssessmentAuditEntry[] = auditRows.map((r) => ({
    action: r.action,
    actorName: r.actor?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

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
    attemptResetMinuteOfDay: row.attemptResetMinuteOfDay,
    allowedLanguages: row.allowedLanguages,
    latePenalty: extractLatePenalty(row.adjustmentRules),
    auditLog,
    totalPoints,
    problemCount: row.problems.length,
    problems,
    myRecentSubmissions,
  };
}
