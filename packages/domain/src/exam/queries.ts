import { courseMembershipRepo, examRepo, runTransaction } from "@nojv/db";
import type { ContestScoringMode, Language, ScoreboardMode } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { checkIpLock, type IpCheckResult } from "../shared/ip";
import { aggregateExamClassStats, aggregateExamMyStatus } from "../shared/list-aggregations";
import { canManageExam } from "./permissions";

export interface ExamListItem {
  allowedLanguages: Language[];
  courseId: string;
  courseTitle: string;
  endsAt: string;
  id: string;
  ipBindingEnabled: boolean;
  ipWhitelistEnabled: boolean;
  pageLockEnabled: boolean;
  participantCount: number;
  problemCount: number;
  scoreboardMode: ScoreboardMode;
  scoringMode: ContestScoringMode;
  startsAt: string;
  status: "draft" | "published" | "archived";
  summary: string;
  title: string;
}

export interface ExamProblemSummary {
  id: string;
  ordinal: number;
  points: number;
  title: string;
}

export interface ExamDetailData {
  allowedLanguages: Language[];
  courseId: string;
  endsAt: string;
  id: string;
  ipBindingEnabled: boolean;
  ipViolationMode: "block" | "notify";
  ipWhitelist: string[];
  ipWhitelistEnabled: boolean;
  isManager: boolean;
  pageLockEnabled: boolean;
  participantCount: number;
  problems: ExamProblemSummary[] | null;
  problemsHidden: boolean;
  scoreboardMode: ScoreboardMode;
  scoringMode: ContestScoringMode;
  startsAt: string;
  status: "draft" | "published" | "archived";
  submitCooldownSec: number;
  summary: string;
  title: string;
}

type ExamWithCounts = NonNullable<Awaited<ReturnType<typeof examRepo.listByCourseId>>>[number];

function mapExamListItem(e: ExamWithCounts): ExamListItem {
  return {
    allowedLanguages: e.allowedLanguages,
    courseId: e.courseId,
    // Exam always has a courseId (FK NOT NULL) so course is always present.
    courseTitle: e.course.title,
    endsAt: e.endsAt.toISOString(),
    id: e.id,
    ipBindingEnabled: e.ipBindingEnabled,
    ipWhitelistEnabled: e.ipWhitelistEnabled,
    pageLockEnabled: e.pageLockEnabled,
    participantCount: e._count.participations,
    problemCount: e._count.problems,
    scoreboardMode: e.scoreboardMode,
    scoringMode: e.scoringMode,
    startsAt: e.startsAt.toISOString(),
    status: e.status,
    summary: e.summary,
    title: e.title,
  };
}

type ExamDetailRow = NonNullable<Awaited<ReturnType<typeof examRepo.findDetailById>>>;

type ExamDetailBase = Omit<ExamDetailData, "isManager" | "problemsHidden" | "problems"> & {
  problems: ExamProblemSummary[];
};

function mapExamDetail(exam: ExamDetailRow): ExamDetailBase {
  return {
    allowedLanguages: exam.allowedLanguages,
    courseId: exam.courseId,
    endsAt: exam.endsAt.toISOString(),
    id: exam.id,
    ipBindingEnabled: exam.ipBindingEnabled,
    ipViolationMode: exam.ipViolationMode,
    ipWhitelist: exam.ipWhitelist,
    ipWhitelistEnabled: exam.ipWhitelistEnabled,
    pageLockEnabled: exam.pageLockEnabled,
    participantCount: exam._count.participations,
    problems: exam.problems.map((ep) => ({
      id: ep.problem.id,
      ordinal: ep.ordinal,
      points: ep.points,
      title: ep.problem.title,
    })),
    scoreboardMode: exam.scoreboardMode,
    scoringMode: exam.scoringMode,
    startsAt: exam.startsAt.toISOString(),
    status: exam.status,
    submitCooldownSec: exam.submitCooldownSec,
    summary: exam.summary,
    title: exam.title,
  };
}

export async function listExamsForCourse(courseId: string): Promise<ExamListItem[]> {
  const exams = await examRepo.listByCourseId(courseId);
  return exams.map(mapExamListItem);
}

export type ExamStatusFilter = "all" | "upcoming" | "running" | "ended" | "draft";

export type ExamRowStatus = "draft" | "upcoming" | "running" | "ended";

export interface ExamProctoring {
  pageLock: boolean;
  ipBinding: boolean;
  ipWhitelist: boolean;
}

export interface ExamListRow {
  id: string;
  title: string;
  status: ExamRowStatus;
  /** ISO strings; null when status === "draft". */
  startsAt: string | null;
  endsAt: string | null;
  /** Duration in minutes (null for draft rows with no window). */
  durationMinutes: number | null;
  scoringMode: "problem_count" | "point_sum";
  problemCount: number;
  proctoring: ExamProctoring;
  /** Participation count — null for students (only managers see it). */
  registeredCount: number | null;
  /** Active-student total for the course — set in the loader. Null = unknown. */
  totalStudents: number | null;
  /** Manager view only — null for students. */
  classStats: { submittedUsers: number; totalStudents: number; avgScore: number } | null;
  /** Student view only — null for managers. */
  myStatus: {
    solved: number;
    total: number;
    score: number;
    totalPoints: number;
  } | null;
}

export interface ExamListCounts {
  all: number;
  upcoming: number;
  running: number;
  ended: number;
  /** Null when the viewer is not a manager. */
  draft: number | null;
}

export interface ExamListResult {
  rows: ExamListRow[];
  counts: ExamListCounts;
}

export interface ListForCourseOptions {
  status: ExamStatusFilter;
  /** `true` for teacher/TA viewers — includes draft rows in the unfiltered set. */
  includeDrafts: boolean;
  forUserId: string;
  limit: number;
  now?: Date;
}

type ExamListRawRow = Awaited<ReturnType<typeof examRepo.listForCourse>>[number];

function rankExamRow(
  status: ExamRowStatus,
  row: { startsAt: Date; endsAt: Date },
  now: Date,
): number {
  // Lower rank = higher priority: running, upcoming, draft, ended.
  if (status === "running") return row.endsAt.getTime() - now.getTime();
  if (status === "upcoming")
    return 1_000_000_000_000 + (row.startsAt.getTime() - now.getTime());
  if (status === "draft") return 2_000_000_000_000;
  return 3_000_000_000_000 - row.endsAt.getTime();
}

function mapExamRow(
  raw: ExamListRawRow,
  includeManagerData: boolean,
  now: Date,
): { row: ExamListRow; rank: number } {
  let status: ExamRowStatus;
  if (raw.status === "draft") {
    status = "draft";
  } else if (raw.startsAt > now) {
    status = "upcoming";
  } else if (raw.endsAt <= now) {
    status = "ended";
  } else {
    status = "running";
  }

  const durationMs = raw.endsAt.getTime() - raw.startsAt.getTime();
  const durationMinutes =
    Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 60_000) : null;

  const row: ExamListRow = {
    id: raw.id,
    title: raw.title,
    status,
    startsAt: status === "draft" ? null : raw.startsAt.toISOString(),
    endsAt: status === "draft" ? null : raw.endsAt.toISOString(),
    durationMinutes: status === "draft" ? null : durationMinutes,
    scoringMode: raw.scoringMode as "problem_count" | "point_sum",
    problemCount: raw._count.problems,
    proctoring: {
      pageLock: raw.pageLockEnabled,
      ipBinding: raw.ipBindingEnabled,
      ipWhitelist: raw.ipWhitelistEnabled,
    },
    registeredCount: includeManagerData ? raw._count.participations : null,
    totalStudents: null,
    classStats: null,
    myStatus: null,
  };

  return {
    row,
    rank: rankExamRow(status, { startsAt: raw.startsAt, endsAt: raw.endsAt }, now),
  };
}

// For courses with more than ~50 exams the chip counts will underreport — acceptable at current scale.
export async function listForCourse(
  courseId: string,
  options: ListForCourseOptions,
): Promise<ExamListResult> {
  const now = options.now ?? new Date();
  const raws = await examRepo.listForCourse(courseId, options.includeDrafts, options.limit);

  const mapped = raws.map((r) => mapExamRow(r, options.includeDrafts, now));

  const counts: ExamListCounts = {
    all: 0,
    upcoming: 0,
    running: 0,
    ended: 0,
    draft: options.includeDrafts ? 0 : null,
  };
  for (const entry of mapped) {
    const s = entry.row.status;
    counts.all += 1;
    if (s === "upcoming") counts.upcoming += 1;
    else if (s === "running") counts.running += 1;
    else if (s === "ended") counts.ended += 1;
    else if (counts.draft !== null) counts.draft += 1;
  }

  const filtered =
    options.status === "all"
      ? mapped
      : mapped.filter((entry) => entry.row.status === options.status);

  filtered.sort((a, b) => a.rank - b.rank);

  const visibleRows = filtered.slice(0, options.limit).map((entry) => entry.row);
  const aggInput = visibleRows.map((r) => ({
    id: r.id,
    courseId,
    problemCount: r.problemCount,
  }));
  if (options.includeDrafts) {
    const stats = await aggregateExamClassStats(aggInput);
    for (const r of visibleRows) r.classStats = stats.get(r.id) ?? null;
  } else {
    const my = await aggregateExamMyStatus(options.forUserId, aggInput);
    for (const r of visibleRows) r.myStatus = my.get(r.id) ?? null;
  }

  return {
    rows: visibleRows,
    counts,
  };
}

export async function listManagedExamsForUser(userId: string): Promise<ExamListItem[]> {
  const memberships = await courseMembershipRepo.listActiveForUser(userId);
  const teacherOrTaCourseIds = memberships
    .filter((m) => m.role === "teacher" || m.role === "ta")
    .map((m) => m.courseId);

  const exams = await examRepo.listManagedForUser(userId, teacherOrTaCourseIds);
  return exams.map(mapExamListItem);
}

export interface ExamDetailOptions {
  userId: string | null;
  now: Date;
}

function resolveVisibility(
  userId: string | null,
  exam: { createdByUserId: string | null; courseId: string; startsAt: Date },
  memberships: Awaited<ReturnType<typeof courseMembershipRepo.listActiveForUser>>,
  now: Date,
): { isManager: boolean; problemsHidden: boolean } {
  const isManager = canManageExam(
    userId,
    { createdByUserId: exam.createdByUserId, courseId: exam.courseId },
    memberships,
  );
  return {
    isManager,
    problemsHidden: !isManager && now < exam.startsAt,
  };
}

export async function getExamDetail(
  examId: string,
  options: ExamDetailOptions,
): Promise<ExamDetailData> {
  const [exam, memberships] = await Promise.all([
    examRepo.findDetailById(examId),
    options.userId === null
      ? Promise.resolve([])
      : courseMembershipRepo.listActiveForUser(options.userId),
  ]);
  if (exam?.status !== "published") {
    throw new NotFoundError(`Exam not found: ${examId}`);
  }

  const { isManager, problemsHidden } = resolveVisibility(
    options.userId,
    exam,
    memberships,
    options.now,
  );

  const base = mapExamDetail(exam);
  return {
    ...base,
    isManager,
    problemsHidden,
    problems: problemsHidden ? null : base.problems,
  };
}

/**
 * Thin wrapper around `examRepo.findById` — used by the exam shell layout
 * to derive `courseId`. Returns null on miss; callers surface a 404.
 */
export async function getExamById(id: string) {
  return examRepo.findById(id);
}

export async function checkExamIpAccess(
  config: {
    ipWhitelistEnabled: boolean;
    ipBindingEnabled: boolean;
    ipWhitelist: string[];
    ipViolationMode: string;
  },
  clientIp: string,
  examId: string,
  userId: string,
  participation: { id: string; ipPin: string | null } | null,
): Promise<IpCheckResult> {
  return runTransaction(async (tx) => {
    return checkIpLock(tx, config, clientIp, participation, { userId, examId });
  });
}
