import { courseMembershipRepo, examRepo, participationRepo, submissionRepo } from "@nojv/db";
import type { ContestScoringMode, Language, ScoreboardMode } from "@nojv/core";

import { getOverridesForContext } from "../scoring/resolve-final-score";

export type ExamDetailStatus = "draft" | "upcoming" | "running" | "ended";

export type ExamProblemViewerState = "ac" | "partial" | "zero" | "empty";

export interface ExamDetailProblem {
  id: string;
  displayId: number;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  points: number;
  ordinal: number;
  letter: string;
  viewerState: ExamProblemViewerState | null;
}

export interface ExamRosterEntry {
  userId: string;
  name: string;
  handle: string | null;
  status: "registered" | "active" | "submitted" | "disqualified";
}

export interface ExamDetailManagerFields {
  rawStatus: "draft" | "published";
  ipWhitelist: string[];
  allowedLanguages: Language[];
  submitCooldownSec: number;
}

export interface ExamDetailPage {
  id: string;
  courseId: string;
  title: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  status: ExamDetailStatus;
  scoringMode: ContestScoringMode;
  scoreboardMode: ScoreboardMode;
  pageLockEnabled: boolean;
  ipBindingEnabled: boolean;
  ipWhitelistEnabled: boolean;
  ipWhitelistCount: number;
  ipViolationMode: "block" | "notify";
  problems: ExamDetailProblem[];
  registeredCount: number;
  totalStudents: number;
  viewerScore: number | null;
  totalPoints: number;
  roster: ExamRosterEntry[] | null;
  manager: ExamDetailManagerFields | null;
}

export interface GetExamDetailPageOptions {
  viewerUserId: string;
  isManager: boolean;
  now?: Date;
}

function letterFromOrdinal(ordinal: number): string {
  const idx = ordinal - 1;
  if (idx < 0 || idx >= 26) return String(ordinal);
  return String.fromCodePoint(65 + idx);
}

function deriveStatus(
  raw: "draft" | "published",
  startsAt: Date,
  endsAt: Date,
  now: Date,
): ExamDetailStatus {
  if (raw === "draft") return "draft";
  if (now < startsAt) return "upcoming";
  if (now >= endsAt) return "ended";
  return "running";
}

type ExamDetailData = NonNullable<
  Awaited<ReturnType<typeof examRepo.findDetailForRegistrationPage>>
>;
type ExamDetailProblemRow = ExamDetailData["problems"][number];

export function resolveScoredState(score: number, points: number): ExamProblemViewerState {
  if (score >= points) return "ac";
  if (score > 0) return "partial";
  return "zero";
}

async function computeViewerScores(
  examId: string,
  viewerUserId: string,
  problemRows: ExamDetailProblemRow[],
): Promise<{
  viewerStateByProblem: Map<string, ExamProblemViewerState>;
  viewerTotalScore: number;
}> {
  const problemIds = problemRows.map((ep) => ep.problem.id);
  const [grouped, overrides] = await Promise.all([
    submissionRepo.groupByUserAndProblem({
      examId,
      userId: viewerUserId,
      problemId: { in: problemIds },
      sampleOnly: false,
    }),
    getOverridesForContext({ type: "exam", examId }),
  ]);

  const bestByProblem = new Map<string, { best: number; count: number }>();
  for (const g of grouped) {
    bestByProblem.set(g.problemId, { best: g._max.score ?? 0, count: g._count.id });
  }

  const viewerStateByProblem = new Map<string, ExamProblemViewerState>();
  let total = 0;
  for (const ep of problemRows) {
    const overrideKey = `${viewerUserId}::${ep.problem.id}`;
    const override = overrides.get(overrideKey);
    const hit = bestByProblem.get(ep.problem.id);
    let score: number;
    let state: ExamProblemViewerState;
    if (override !== undefined) {
      score = override;
      state = resolveScoredState(override, ep.points);
    } else if (!hit || hit.count === 0) {
      score = 0;
      state = "empty";
    } else {
      score = hit.best;
      state = resolveScoredState(hit.best, ep.points);
    }
    viewerStateByProblem.set(ep.problem.id, state);
    total += score;
  }

  return { viewerStateByProblem, viewerTotalScore: total };
}

export async function getExamDetailPage(
  examId: string,
  options: GetExamDetailPageOptions,
): Promise<ExamDetailPage | null> {
  const now = options.now ?? new Date();
  const exam = await examRepo.findDetailForRegistrationPage(examId);
  if (!exam) return null;

  if (exam.status === "draft" && !options.isManager) return null;

  const [roster, students] = await Promise.all([
    options.isManager
      ? participationRepo.listExamParticipantsWithUser(examId)
      : Promise.resolve(null),
    courseMembershipRepo.findStudents(exam.courseId),
  ]);

  const derivedStatus = deriveStatus(exam.status, exam.startsAt, exam.endsAt, now);

  const hideProblemsFromViewer =
    !options.isManager &&
    (derivedStatus === "upcoming" || derivedStatus === "draft" || exam.course.archived);

  const problemRows = hideProblemsFromViewer ? [] : exam.problems;

  const enrichWithViewerScores =
    !options.isManager && derivedStatus === "ended" && problemRows.length > 0;

  const viewerScores = enrichWithViewerScores
    ? await computeViewerScores(examId, options.viewerUserId, problemRows)
    : {
        viewerStateByProblem: new Map<string, ExamProblemViewerState>(),
        viewerTotalScore: null,
      };
  const { viewerStateByProblem, viewerTotalScore } = viewerScores;

  const problems: ExamDetailProblem[] = problemRows.map((ep) => ({
    id: ep.problem.id,
    displayId: ep.problem.displayId,
    title: ep.problem.title,
    difficulty: ep.problem.difficulty,
    points: ep.points,
    ordinal: ep.ordinal,
    letter: letterFromOrdinal(ep.ordinal),
    viewerState: viewerStateByProblem.get(ep.problem.id) ?? null,
  }));

  const totalPoints = problems.reduce((sum, p) => sum + p.points, 0);

  const rosterMapped: ExamRosterEntry[] | null =
    roster === null
      ? null
      : roster.map((p) => ({
          userId: p.user.id,
          name: p.user.name,
          handle: p.user.username,
          status: p.status,
        }));

  const manager: ExamDetailManagerFields | null = options.isManager
    ? {
        rawStatus: exam.status,
        ipWhitelist: exam.ipWhitelist,
        allowedLanguages: exam.allowedLanguages,
        submitCooldownSec: exam.submitCooldownSec,
      }
    : null;

  return {
    id: exam.id,
    courseId: exam.courseId,
    title: exam.title,
    summary: exam.summary,
    startsAt: exam.startsAt.toISOString(),
    endsAt: exam.endsAt.toISOString(),
    status: derivedStatus,
    scoringMode: exam.scoringMode,
    scoreboardMode: exam.scoreboardMode,
    pageLockEnabled: exam.pageLockEnabled,
    ipBindingEnabled: exam.ipBindingEnabled,
    ipWhitelistEnabled: exam.ipWhitelistEnabled,
    ipWhitelistCount: exam.ipWhitelist.length,
    ipViolationMode: exam.ipViolationMode,
    problems,
    registeredCount: exam._count.participations,
    totalStudents: students.length,
    viewerScore: viewerTotalScore,
    totalPoints,
    roster: rosterMapped,
    manager,
  };
}
