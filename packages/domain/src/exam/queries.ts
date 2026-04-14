import { courseMembershipRepo, examRepo, runTransaction } from "@nojv/db";
import type { ContestScoringMode, Language, ScoreboardMode } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { checkIpLock, type IpCheckResult } from "../shared/ip-utils";
import { canManageExam } from "./permissions";

// Exam reuses ContestScoringMode from @nojv/core — the scoring
// algorithms (ICPC / IOI) are identical; Prisma separates the enums
// at the type level so queries.ts maps between them.

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
  frozenAt: string | null;
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
    allowedLanguages: e.allowedLanguages as Language[],
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
    scoreboardMode: e.scoreboardMode as ScoreboardMode,
    scoringMode: e.scoringMode as ContestScoringMode,
    startsAt: e.startsAt.toISOString(),
    status: e.status,
    summary: e.summary,
    title: e.title
  };
}

type ExamDetailRow = NonNullable<Awaited<ReturnType<typeof examRepo.findDetailById>>>;

type ExamDetailBase = Omit<ExamDetailData, "isManager" | "problemsHidden" | "problems"> & {
  problems: ExamProblemSummary[];
};

function mapExamDetail(exam: ExamDetailRow): ExamDetailBase {
  return {
    allowedLanguages: exam.allowedLanguages as Language[],
    courseId: exam.courseId,
    endsAt: exam.endsAt.toISOString(),
    frozenAt: exam.frozenAt?.toISOString() ?? null,
    id: exam.id,
    ipBindingEnabled: exam.ipBindingEnabled,
    ipViolationMode: exam.ipViolationMode as "block" | "notify",
    ipWhitelist: exam.ipWhitelist,
    ipWhitelistEnabled: exam.ipWhitelistEnabled,
    pageLockEnabled: exam.pageLockEnabled,
    participantCount: exam._count.participations,
    problems: exam.problems.map((ep) => ({
      id: ep.problem.id,
      ordinal: ep.ordinal,
      points: ep.points,
      title: ep.problem.title
    })),
    scoreboardMode: exam.scoreboardMode as ScoreboardMode,
    scoringMode: exam.scoringMode as ContestScoringMode,
    startsAt: exam.startsAt.toISOString(),
    status: exam.status,
    submitCooldownSec: exam.submitCooldownSec,
    summary: exam.summary,
    title: exam.title
  };
}

export async function listExamsForCourse(courseId: string): Promise<ExamListItem[]> {
  const exams = await examRepo.listByCourseId(courseId);
  return exams.map(mapExamListItem);
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
  now: Date
): { isManager: boolean; problemsHidden: boolean } {
  const isManager = canManageExam(
    userId,
    { createdByUserId: exam.createdByUserId, courseId: exam.courseId },
    memberships
  );
  return {
    isManager,
    problemsHidden: !isManager && now < exam.startsAt
  };
}

export async function getExamDetail(
  examId: string,
  options: ExamDetailOptions
): Promise<ExamDetailData> {
  const [exam, memberships] = await Promise.all([
    examRepo.findDetailById(examId),
    options.userId === null
      ? Promise.resolve([])
      : courseMembershipRepo.listActiveForUser(options.userId)
  ]);
  if (exam?.status !== "published") {
    throw new NotFoundError(`Exam not found: ${examId}`);
  }

  const { isManager, problemsHidden } = resolveVisibility(
    options.userId,
    exam,
    memberships,
    options.now
  );

  const base = mapExamDetail(exam);
  return {
    ...base,
    isManager,
    problemsHidden,
    problems: problemsHidden ? null : base.problems
  };
}

/**
 * Run IP lock check for an exam detail page visit inside a transaction.
 */
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
  participation: { id: string; ipPin: string | null } | null
): Promise<IpCheckResult> {
  return runTransaction(async (tx) => {
    return checkIpLock(
      tx,
      config,
      clientIp,
      participation ? { id: participation.id, boundIp: participation.ipPin } : null,
      { userId, scope: { kind: "exam", examId } }
    );
  });
}
