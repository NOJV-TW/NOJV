import {
  assessmentRepo,
  problemRepo,
  submissionRepo,
  submissionRejudgeLogRepo,
} from "@nojv/db";
import type { Prisma } from "@nojv/db";
import { attemptWindowStart } from "./attempt-window";
import {
  adjustmentRulesSchema,
  advancedConfigSchema,
  judgeConfigSchema,
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema,
  verdictSummarySchema,
  type AdjustmentRules,
  type AdvancedConfig,
  type JudgeConfig,
  type Language,
  type ProblemJudgeTestcase,
  type Runtime,
  type SubmissionDraft,
  type SubmissionResult,
} from "@nojv/core";
import {
  getSubmissionSources as storageGetSubmissionSources,
  getVerdictDetail as storageGetVerdictDetail,
  type SubmissionSource,
} from "@nojv/storage";
import { z } from "zod";

import {
  readTestcaseBlobs,
  readValidatorScriptBlob,
  readWorkspaceFileBlob,
} from "../problem/blobs";
import { computeProblemTotalScore } from "../problem/total-score";
import { buildProblemSamples } from "../problem/queries";
import type { ActorContext } from "../shared/actor-context";
import { IntegrityError, NotFoundError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import { canOperateOnSubmission } from "./permissions";
import { sanitizeStudentResult } from "./scoring";
import type {
  AdjustmentContext,
  AdvancedModeContext,
  SubmissionJudgeContext,
  TestcaseSetGroup,
  WorkspaceFileEntry,
} from "./types";

export async function getSubmissionForUser(
  submissionId: string,
  userId: string,
  isAdmin: boolean,
) {
  const submission = await submissionRepo.findById(submissionId);

  if (!submission) {
    throw new NotFoundError("Submission not found.");
  }

  if (submission.userId !== userId && !isAdmin) {
    throw new NotFoundError("Submission not found.");
  }

  return submission;
}

export async function getSubmissionById(id: string) {
  return submissionRepo.findById(id);
}

export async function getSubmissionSources(submissionId: string): Promise<SubmissionSource[]> {
  return storageGetSubmissionSources(storage(), submissionId);
}

// intentional-nullable: no verdict-detail blob exists until a submission is judged; a malformed or stale blob is treated as absent.
export async function getVerdictDetail(submissionId: string): Promise<SubmissionResult | null> {
  const raw = await storageGetVerdictDetail(storage(), submissionId);
  if (raw === null) return null;
  const parsed = submissionResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function getSubmissionDetail(actor: ActorContext, submissionId: string) {
  const submission = await submissionRepo.findByIdForDetail(submissionId);
  if (!submission) throw new NotFoundError("Submission not found.");

  const isOwner = submission.userId === actor.userId;
  const viewerIsStaff = !isOwner && (await canOperateOnSubmission(actor, submission));

  if (!isOwner && !viewerIsStaff) {
    throw new NotFoundError("Submission not found.");
  }

  const language = languageSchema.parse(submission.language);

  const [rawResult, sources] = await Promise.all([
    submission.verdictDetailStorageKey ? getVerdictDetail(submissionId) : Promise.resolve(null),
    getSubmissionSources(submissionId),
  ]);
  const result =
    rawResult === null || viewerIsStaff
      ? rawResult
      : sanitizeStudentResult(rawResult, { sampleOnly: submission.sampleOnly });

  return {
    id: submission.id,
    createdAt: submission.createdAt.toISOString(),
    language,
    sources,
    status: submission.status,
    score: submission.score,
    runtimeMs: submission.runtimeMs,
    memoryKb: submission.memoryKb,
    sampleOnly: submission.sampleOnly,
    result,
    problem: {
      id: submission.problem.id,
      displayId: submission.problem.displayId,
      title: submission.problem.title,
    },
    totalScore: computeProblemTotalScore({
      type: submission.problem.type,
      testcaseSets: submission.problem.testcaseSets,
      advancedConfig: submission.problem.advancedConfig,
    }),
    context: buildSubmissionContext(submission),
    submitter: viewerIsStaff
      ? { name: submission.user.name, username: submission.user.username }
      : null,
    viewerIsStaff,
  };
}

export type SubmissionContextKind = "exam" | "contest" | "assignment" | "practice";

export function deriveSubmissionContextKind(fks: {
  contestId: string | null;
  assessmentId: string | null;
  examId: string | null;
}): SubmissionContextKind {
  if (fks.examId) return "exam";
  if (fks.contestId) return "contest";
  if (fks.assessmentId) return "assignment";
  return "practice";
}

function buildSubmissionContext(submission: {
  contestId: string | null;
  contest: { id: string; title: string } | null;
  assessmentId: string | null;
  assessment: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; title: string };
  } | null;
  examId: string | null;
  exam: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; title: string };
  } | null;
}) {
  if (submission.contest) {
    return {
      kind: "contest" as const,
      contestId: submission.contest.id,
      contestTitle: submission.contest.title,
    };
  }
  if (submission.assessment) {
    return {
      kind: "assignment" as const,
      assignmentId: submission.assessment.id,
      assignmentTitle: submission.assessment.title,
      courseId: submission.assessment.course.id,
      courseTitle: submission.assessment.course.title,
    };
  }
  if (submission.exam) {
    return {
      kind: "exam" as const,
      examId: submission.exam.id,
      examTitle: submission.exam.title,
      courseId: submission.exam.course.id,
      courseTitle: submission.exam.course.title,
    };
  }
  return { kind: "practice" as const };
}

export async function listUserSubmissions(userId: string) {
  const submissions = await submissionRepo.listByUser({ userId });

  return submissions.map((s) => {
    const language = languageSchema.parse(s.language);

    return {
      createdAt: s.createdAt.toISOString(),
      id: s.id,
      language,
      problemId: s.problem.id,
      problemTitle: s.problem.title,
      runtimeMs: s.runtimeMs,
      memoryKb: s.memoryKb,
      score: s.score,
      totalScore: computeProblemTotalScore({
        type: s.problem.type,
        testcaseSets: s.problem.testcaseSets,
        advancedConfig: s.problem.advancedConfig,
      }),
      status: s.status,
      context: deriveSubmissionContextKind(s),
    };
  });
}

export async function listRejudgeLogsPaged(opts: {
  limit: number;
  cursor?: string;
  problemId?: string;
  rejudgedByUserId?: string;
}) {
  const rows = await submissionRejudgeLogRepo.listPaged(opts);
  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  return { items, nextCursor };
}

export async function listAllSubmissionsPaged(opts: {
  limit: number;
  cursor?: string;
  userId?: string;
  problemId?: string;
}) {
  const rows = await submissionRepo.listAllPaged(opts);
  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  return {
    items: items.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      language: s.language,
      score: s.score,
      status: s.status,
      context: deriveSubmissionContextKind(s),
      problem: s.problem,
      user: s.user,
    })),
    nextCursor,
  };
}

export async function countAssignmentProblemAttemptsInWindow(
  userId: string,
  assignmentId: string,
  problemId: string,
  resetHour: number,
): Promise<number> {
  const windowStart = attemptWindowStart(resetHour, new Date());
  return submissionRepo.countForUserAssessmentProblemSince(
    userId,
    assignmentId,
    problemId,
    windowStart,
  );
}

export async function listProblemSubmissions(
  userId: string,
  problemId: string,
  context?: { assignmentId: string; courseId: string } | { contestId: string },
) {
  const isAssignmentFilter = context !== undefined && "assignmentId" in context;

  const problemP = problemRepo.findById(problemId);

  const assignmentP = isAssignmentFilter
    ? assessmentRepo.findByCourseAndId(context.courseId, context.assignmentId)
    : null;

  const [problem, assignment] = await Promise.all([problemP, assignmentP]);

  if (!problem) return [];
  if (isAssignmentFilter && !assignment) return [];

  const assessmentId = assignment?.id;
  const contestId =
    context !== undefined && "contestId" in context ? context.contestId : undefined;

  const submissions = await submissionRepo.listByUserAndProblem({
    problemId: problem.id,
    userId,
    statusIn: [...submissionVerdicts],
    ...(assessmentId ? { assessmentId } : {}),
    ...(contestId ? { contestId } : {}),
  });

  return submissions.map((s) => {
    const { verdict, language } = narrowSubmissionRow(s);
    const parsedSummary =
      s.verdictSummary == null ? null : verdictSummarySchema.safeParse(s.verdictSummary);
    const summary = parsedSummary?.success ? parsedSummary.data : null;
    const result: SubmissionResult = {
      accepted: verdict === "accepted",
      verdict,
      score: s.score,
      runtimeMs: s.runtimeMs ?? 0,
      feedback:
        summary?.compilerErrorTruncated ??
        (verdict === "accepted" ? "Accepted." : "Verdict details unavailable."),
    };

    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString(),
      context: deriveSubmissionContextKind(s),
    };
  });
}

export function narrowSubmissionRow(row: { status: string; language: string }): {
  verdict: ReturnType<typeof submissionVerdictSchema.parse>;
  language: Language;
} {
  return {
    verdict: submissionVerdictSchema.parse(row.status),
    language: languageSchema.parse(row.language),
  };
}

const inputFileKeysSchema = z.record(z.string(), z.string());

const DEFAULT_JUDGE_CONFIG: JudgeConfig = { type: "standard" };

function parseJudgeConfig(raw: unknown, submissionId: string): JudgeConfig {
  if (raw == null) return DEFAULT_JUDGE_CONFIG;
  const result = judgeConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new IntegrityError(
    `Invalid judgeConfig for submission ${submissionId}: ${result.error.issues
      .map((issue) => issue.path.join(".") || issue.code)
      .join(", ")}`,
  );
}

function parseAdjustmentRules(raw: unknown, submissionId: string): AdjustmentRules | null {
  if (raw == null) return null;
  const result = adjustmentRulesSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new IntegrityError(
    `Invalid adjustmentRules for submission ${submissionId}: ${result.error.issues
      .map((issue) => issue.path.join(".") || issue.code)
      .join(", ")}`,
  );
}

function parseAdvancedConfig(raw: unknown, submissionId: string): AdvancedConfig | null {
  if (raw == null) return null;
  const result = advancedConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new IntegrityError(
    `Invalid advancedConfig for submission ${submissionId}: ${result.error.issues
      .map((issue) => issue.path.join(".") || issue.code)
      .join(", ")}`,
  );
}

function parseInputFileKeys(raw: unknown, testcaseId: string): Record<string, string> | null {
  if (raw == null) return null;
  const result = inputFileKeysSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new IntegrityError(
    `Invalid inputFileKeys for testcase ${testcaseId}: ${result.error.issues
      .map((issue) => issue.path.join(".") || issue.code)
      .join(", ")}`,
  );
}

export function deriveJudgeMode(
  context: Pick<SubmissionJudgeContext, "problemType" | "advanced">,
): "standard" | "advanced" {
  return context.problemType === "special_env" && context.advanced !== null
    ? "advanced"
    : "standard";
}

export async function getJudgeContext(submissionId: string): Promise<SubmissionJudgeContext> {
  const submission = await submissionRepo.findByIdWithJudgeContext(submissionId);

  if (!submission) throw new NotFoundError(`Submission ${submissionId} not found`);

  const { problem } = submission;
  const judgeConfig = parseJudgeConfig(problem.judgeConfig, submissionId);

  const testcaseSets: TestcaseSetGroup[] = await Promise.all(
    problem.testcaseSets.map(async (ts) => {
      const testcases = await Promise.all(
        ts.testcases.map(async (testcase): Promise<ProblemJudgeTestcase> => {
          const blobs = await readTestcaseBlobs({
            inputKey: testcase.inputKey,
            outputKey: testcase.outputKey,
            inputFileKeys: parseInputFileKeys(testcase.inputFileKeys, testcase.id),
          });
          return {
            id: testcase.id,
            input: blobs.input,
            ...(blobs.output !== undefined ? { output: blobs.output } : {}),
            ...(blobs.inputFiles !== undefined ? { inputFiles: blobs.inputFiles } : {}),
            weight: ts.weight,
          };
        }),
      );
      return {
        id: ts.id,
        name: ts.name,
        testcases,
        weight: ts.weight,
      };
    }),
  );

  const samples = buildProblemSamples(problem);

  const runtime: Runtime = judgeConfig.runtime ?? {
    env: {},
    memoryLimitMb: problem.memoryLimitMb,
    timeLimitMs: problem.timeLimitMs,
  };

  const workspaceFiles: WorkspaceFileEntry[] = await Promise.all(
    problem.workspaceFiles.map(async (f): Promise<WorkspaceFileEntry> => ({
      content: await readWorkspaceFileBlob(f.contentKey),
      language: f.language,
      path: f.path,
      visibility: f.visibility,
    })),
  );

  const assignment = submission.assessment;

  const contestEnd = submission.contest?.endsAt ?? null;
  const adjustment: AdjustmentContext = {
    assignmentAdjustmentRules: assignment
      ? parseAdjustmentRules(assignment.adjustmentRules, submissionId)
      : null,
    dueAt: assignment?.dueAt ?? contestEnd,
    finalDay: assignment?.closesAt ?? contestEnd,
    submittedAt: submission.createdAt,
  };

  const problemType = problem.type;
  const advancedConfig = parseAdvancedConfig(problem.advancedConfig, submissionId);
  const advanced: AdvancedModeContext | null =
    problemType === "special_env" && advancedConfig !== null
      ? {
          config: advancedConfig,
          resourceLimits: {
            totalTimeMs: problem.timeLimitMs,
            memoryMb: problem.memoryLimitMb,
          },
        }
      : null;

  const [checkerScript, interactorScript] = await Promise.all([
    judgeConfig.checkerKey
      ? readValidatorScriptBlob(judgeConfig.checkerKey)
      : Promise.resolve(null),
    judgeConfig.interactorKey
      ? readValidatorScriptBlob(judgeConfig.interactorKey)
      : Promise.resolve(null),
  ]);

  return {
    adjustment,
    checkerScript,
    interactorScript,
    compareOptions: judgeConfig.compare ?? null,
    judgeType: judgeConfig.type,
    runtime,
    samples,
    problemType,
    testcaseSets,
    workspaceFiles,
    advanced,
  };
}

export type JudgeDispatchMeta = Pick<SubmissionJudgeContext, "problemType" | "advanced">;

export async function getJudgeDispatchMeta(submissionId: string): Promise<JudgeDispatchMeta> {
  const submission = await submissionRepo.findByIdForDispatchMeta(submissionId);
  if (!submission) throw new NotFoundError(`Submission ${submissionId} not found`);

  const { problem } = submission;
  const advancedConfig = parseAdvancedConfig(problem.advancedConfig, submissionId);
  const advanced: AdvancedModeContext | null =
    problem.type === "special_env" && advancedConfig !== null
      ? {
          config: advancedConfig,
          resourceLimits: {
            totalTimeMs: problem.timeLimitMs,
            memoryMb: problem.memoryLimitMb,
          },
        }
      : null;

  return { problemType: problem.type, advanced };
}

const IN_FLIGHT_SUBMISSION_STATUSES = [
  "pending_upload",
  "queued",
  "compiling",
  "running",
] as const;

export async function listForRejudge(input: {
  problemId: string;
  contestId?: string;
  assignmentId?: string;
  examId?: string;
  userIds?: string[];
  since?: Date;
  until?: Date;
}): Promise<{ submissionId: string; draft: SubmissionDraft }[]> {
  const where: Prisma.SubmissionWhereInput = {
    problemId: input.problemId,
    sampleOnly: false,
    status: { notIn: [...IN_FLIGHT_SUBMISSION_STATUSES] },
  };

  if (input.contestId) {
    where.contestId = input.contestId;
  }
  if (input.assignmentId) {
    where.assessmentId = input.assignmentId;
  }
  if (input.examId) {
    where.examId = input.examId;
  }
  if (input.userIds && input.userIds.length > 0) {
    where.userId = { in: input.userIds };
  }
  if (input.since || input.until) {
    where.createdAt = {
      ...(input.since ? { gte: input.since } : {}),
      ...(input.until ? { lte: input.until } : {}),
    };
  }

  const submissions = await submissionRepo.findForRejudge(where);

  return submissions.map((s) => ({
    submissionId: s.id,
    draft: {
      language: s.language,
      problemId: s.problemId,
      sampleOnly: s.sampleOnly,
    },
  }));
}

export async function findOneForRejudge(
  submissionId: string,
): Promise<{ submissionId: string; draft: SubmissionDraft } | null> {
  const submission = await submissionRepo.findById(submissionId);
  if (!submission) return null;
  if ((IN_FLIGHT_SUBMISSION_STATUSES as readonly string[]).includes(submission.status)) {
    return null;
  }
  return {
    submissionId: submission.id,
    draft: {
      language: submission.language,
      problemId: submission.problemId,
      sampleOnly: submission.sampleOnly,
    },
  };
}
