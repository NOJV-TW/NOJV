import type { Prisma } from "../../../generated/prisma/client";
import type { SupportedLanguage, SubmissionStatus } from "../../../generated/prisma/enums";
import type { TransactionClient } from "../../transaction";
import { problemMiniSelect, userMiniSelect } from "../selects";

export type TxClient = TransactionClient;
export type SubmissionClient = Pick<TxClient, "submission">;

export const submissionResultStatuses: SubmissionStatus[] = [
  "accepted",
  "wrong_answer",
  "compile_error",
  "runtime_error",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "system_error",
];

export type SubmissionCreateContext =
  | { type: "practice" }
  | { type: "assignment"; assessmentId: string; courseId: string }
  | { type: "exam"; examId: string }
  | { type: "contest"; contestId: string }
  | { type: "virtual"; participationId: string };

export type CanonicalSubmissionCreateInput = Omit<
  Prisma.SubmissionUncheckedCreateInput,
  "assessmentId" | "contestId" | "courseId" | "examId" | "participationId"
> & { context: SubmissionCreateContext };

export function submissionContextColumns(
  context: SubmissionCreateContext,
): Pick<
  Prisma.SubmissionUncheckedCreateInput,
  "assessmentId" | "contestId" | "courseId" | "examId" | "participationId"
> {
  return {
    assessmentId: context.type === "assignment" ? context.assessmentId : null,
    courseId: context.type === "assignment" ? context.courseId : null,
    examId: context.type === "exam" ? context.examId : null,
    contestId: context.type === "contest" ? context.contestId : null,
    participationId: context.type === "virtual" ? context.participationId : null,
  };
}

export function userFacingSubmissionWhere(
  userId: string,
  enforceExamConfinement: boolean,
): Prisma.SubmissionWhereInput {
  if (!enforceExamConfinement) return { userId };

  return {
    userId,
    OR: [
      {
        user: {
          activeExamSessions: { none: { endedAt: null } },
        },
      },
      {
        exam: {
          activeSessions: { some: { userId, endedAt: null } },
        },
      },
    ],
  };
}

export const contestExamListSelect = {
  id: true,
  createdAt: true,
  language: true,
  score: true,
  status: true,
  runtimeMs: true,
  problem: { select: problemMiniSelect },
  user: { select: userMiniSelect },
} satisfies Prisma.SubmissionSelect;

export const scoringBaseSelect = {
  createdAt: true,
  problemId: true,
  score: true,
  status: true,
} satisfies Prisma.SubmissionSelect;

export const submissionDetailSelect = {
  id: true,
  userId: true,
  problemId: true,
  contestId: true,
  courseId: true,
  assessmentId: true,
  examId: true,
  sampleOnly: true,
  language: true,
  sourceStorage: true,
  status: true,
  score: true,
  runtimeMs: true,
  memoryKb: true,
  verdictSummary: true,
  verdictDetailStorage: true,
  activeJudgeRunId: true,
  createdAt: true,
  updatedAt: true,
  judgeGeneration: true,
  user: { select: userMiniSelect },
  problem: {
    select: {
      ...problemMiniSelect,
      type: true,
      advancedConfig: true,
      testcaseSets: { select: { weight: true } },
    },
  },
  contest: { select: { id: true, title: true } },
  assessment: {
    select: {
      id: true,
      title: true,
      courseId: true,
      course: { select: { id: true, title: true } },
    },
  },
  exam: {
    select: {
      id: true,
      title: true,
      courseId: true,
      course: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.SubmissionSelect;

export interface SubmissionHistoryFilters {
  problemId?: string;
  status?: SubmissionStatus;
  language?: SupportedLanguage;
  contextType?: "practice" | "assignment" | "contest" | "exam" | "virtual";
  search?: string;
  userSearch?: string;
  ipSearch?: string;
}

export interface SubmissionHistoryBoundary {
  id: string;
  createdAt: Date;
}
