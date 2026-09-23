import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assessmentRepo,
  contestRepo,
  courseRepo,
  examRepo,
  problemRepo,
  submissionRepo,
  submissionRejudgeLogRepo,
} from "@nojv/db";
import {
  isSubmissionPending,
  languageSchema,
  submissionOperationStatuses,
  submissionOperationStatusSchema,
  submissionVerdictSchema,
  verdictSummarySchema,
  type Language,
  type SubmissionContext,
  type SubmissionOperationStatus,
} from "@nojv/core";
import { applyQueuedRejudges } from "./operations";
import { submissionSummaryResult, type SubmissionStateRow } from "./operation-state";
import { queuedRejudges } from "./rejudge-control";
import { attemptWindowStart } from "./attempt-window";
import { computeProblemTotalScore } from "../problem/total-score";
import { canManageContest } from "../contest/permissions";
import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";
import { canManageCourse, resolveEffectiveCourseRole } from "../shared/permissions";
import { deriveSubmissionContextKind } from "./context";

export type SubmissionHistoryFilters = Parameters<
  typeof submissionRepo.listHistoryPage
>[0]["filters"];

interface HistoryOptions {
  actor: ActorContext;
  limit: number;
  page?: number;
  snapshot?: string;
  filters?: SubmissionHistoryFilters;
}

const historySnapshotSchema = z
  .object({
    id: z.string().max(128),
    createdAt: z.iso.datetime(),
    scope: z.string().length(64),
  })
  .strict();

async function historyPage(opts: HistoryOptions, context?: SubmissionContextRef) {
  const page = opts.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * 50))
    throw new ValidationError("Invalid submission page.");
  const filters = opts.filters ?? {};
  const scope = createHash("sha256")
    .update(
      JSON.stringify({
        userId: opts.actor.userId,
        role: opts.actor.platformRole,
        context: context ?? null,
        problemId: filters.problemId ?? null,
        status: filters.status ?? null,
        language: filters.language ?? null,
        contextType: filters.contextType ?? null,
        search: filters.search ?? null,
        userSearch: filters.userSearch ?? null,
        ipSearch: filters.ipSearch ?? null,
      }),
    )
    .digest("hex");
  let snapshot: { id: string; createdAt: Date } | undefined;
  if (opts.snapshot) {
    try {
      const parsed = historySnapshotSchema.parse(
        JSON.parse(Buffer.from(opts.snapshot, "base64url").toString("utf8")),
      );
      if (parsed.scope !== scope || new Date(parsed.createdAt).getTime() > Date.now())
        throw new Error("scope");
      snapshot = { id: parsed.id, createdAt: new Date(parsed.createdAt) };
    } catch {
      throw new ValidationError("Invalid submission snapshot.");
    }
  }
  const queued = await queuedRejudges({
    ...(!context && opts.actor.platformRole !== "admin" ? { userId: opts.actor.userId } : {}),
    ...(context ? { context } : {}),
  });
  const result = await submissionRepo.listHistoryPage({
    queuedRejudgeIds: [...queued].filter(([, work]) => work.pending).map(([id]) => id),
    ...(!context && opts.actor.platformRole !== "admin" ? { userId: opts.actor.userId } : {}),
    ...(context ? { context } : {}),
    filters,
    page,
    limit: 50,
    ...(snapshot ? { snapshot } : {}),
  });
  if (!result) throw new ValidationError("Invalid submission snapshot.");
  const rows = await applyQueuedRejudges(result.rows, queued);
  return {
    rows,
    page,
    pageSize: 50,
    nextCursor: null,
    totalCount: result.totalCount,
    totalPages: Math.max(1, Math.ceil(result.totalCount / 50)),
    newCount: result.newCount,
    snapshot: Buffer.from(
      JSON.stringify({
        ...result.snapshot,
        createdAt: result.snapshot.createdAt.toISOString(),
        scope,
      }),
    ).toString("base64url"),
  };
}

export async function listUserSubmissions(opts: HistoryOptions) {
  const { rows, ...page } = await historyPage(opts);
  return {
    ...page,
    items: rows.map((s) => ({
      createdAt: s.createdAt.toISOString(),
      id: s.id,
      language: languageSchema.parse(s.language),
      problemId: s.problem.id,
      problemTitle: s.problem.title,
      user:
        opts.actor.platformRole === "admin"
          ? { name: s.user.name, username: s.user.username }
          : null,
      runtimeMs: isSubmissionPending(s.status)
        ? null
        : s.status === "system_error"
          ? 0
          : s.runtimeMs,
      memoryKb:
        isSubmissionPending(s.status) || s.status === "system_error" ? null : s.memoryKb,
      score: isSubmissionPending(s.status) ? null : s.status === "system_error" ? 0 : s.score,
      totalScore: computeProblemTotalScore(s.problem),
      status: s.status,
      judgeGeneration: s.judgeGeneration,
      updatedAt: s.updatedAt.toISOString(),
      context: s.participationId ? ("virtual" as const) : deriveSubmissionContextKind(s),
    })),
  };
}

export async function listContextSubmissionsPaged(
  opts: HistoryOptions & { context: SubmissionContextRef },
) {
  await assertContextSubmissionsRead(opts.actor, opts.context);
  const { rows, ...page } = await historyPage(opts, opts.context);
  return {
    ...page,
    items: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      score: isSubmissionPending(row.status)
        ? null
        : row.status === "system_error"
          ? 0
          : row.score,
      runtimeMs: isSubmissionPending(row.status)
        ? null
        : row.status === "system_error"
          ? 0
          : row.runtimeMs,
      memoryKb:
        isSubmissionPending(row.status) || row.status === "system_error" ? null : row.memoryKb,
    })),
  };
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
  status?: SubmissionOperationStatus;
}) {
  const rows = await submissionRepo.listAllPaged(opts);
  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  return {
    items: items.map((s) => {
      const summary =
        s.verdictSummary === null ? null : verdictSummarySchema.safeParse(s.verdictSummary);
      return {
        id: s.id,
        createdAt: s.createdAt,
        language: s.language,
        score: s.score,
        status: s.status,
        systemError: summary?.success ? (summary.data.systemErrorTruncated ?? null) : null,
        context: deriveSubmissionContextKind(s),
        problem: s.problem,
        user: s.user,
      };
    }),
    nextCursor,
  };
}

interface SubmissionContextRef {
  type: "assignment" | "exam" | "contest";
  id: string;
}

async function assertContextSubmissionsRead(
  actor: ActorContext,
  context: SubmissionContextRef,
) {
  if (context.type === "contest") {
    const contest = await contestRepo.findById(context.id);
    if (!contest) throw new NotFoundError("Contest not found.");
    if (!canManageContest(actor.userId, contest, actor.platformRole)) {
      throw new ForbiddenError("Not authorized to view context submissions.");
    }
    return;
  }
  const entity =
    context.type === "assignment"
      ? await assessmentRepo.findByIdWithCourseId(context.id)
      : await examRepo.findById(context.id);
  if (!entity) {
    throw new NotFoundError(
      context.type === "assignment" ? "Assignment not found." : "Exam not found.",
    );
  }

  const course = await courseRepo.findByIdWithUserMembership(entity.courseId, actor.userId);
  if (!course) throw new NotFoundError("Course not found.");
  const membership = course.memberships[0] ?? null;
  const canManage =
    course.ownerId === actor.userId ||
    canManageCourse(
      resolveEffectiveCourseRole(
        actor.platformRole,
        membership?.status === "active" ? membership.role : null,
      ),
    );
  if (!canManage) {
    throw new ForbiddenError("Not authorized to view context submissions.");
  }
}

export async function listRecentContextSubmissions(opts: {
  actor: ActorContext;
  context: SubmissionContextRef;
  limit?: number;
}) {
  await assertContextSubmissionsRead(opts.actor, opts.context);

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await submissionRepo.listRecentForContext({ context: opts.context, limit });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
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
    statusIn: [...submissionOperationStatuses],
    ...(assessmentId ? { assessmentId } : {}),
    ...(contestId ? { contestId } : {}),
  });

  return (await applyQueuedRejudges(submissions)).map(toProblemSubmissionEntry);
}

export async function listWorkspaceSubmissions(opts: {
  actor: ActorContext;
  problemId: string;
  context: SubmissionContext;
  cursor?: string;
}) {
  const limit = 50;
  const context = opts.context;
  const rows = await submissionRepo.listByUser({
    userId: opts.actor.userId,
    enforceExamConfinement: true,
    problemId: opts.problemId,
    limit,
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(context.type === "exam" ? { examId: context.examId } : {}),
    ...(context.type === "assignment" ? { assessmentId: context.assessmentId } : {}),
    ...(context.type === "contest" ? { contestId: context.contestId } : {}),
    ...(context.type === "virtual" ? { participationId: context.participationId } : {}),
  });
  if (rows === null) throw new ValidationError("Invalid submission cursor.");
  const items = rows.slice(0, limit);
  return {
    items: (await applyQueuedRejudges(items)).map(toProblemSubmissionEntry),
    nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
  };
}

export function toProblemSubmissionEntry(
  s: SubmissionStateRow & {
    createdAt: Date;
    language: string;
    contestId: string | null;
    assessmentId: string | null;
    examId: string | null;
  },
) {
  const result = submissionSummaryResult(s);
  return {
    id: s.id,
    language: languageSchema.parse(s.language),
    status: submissionOperationStatusSchema.parse(s.status),
    judgeGeneration: s.judgeGeneration,
    updatedAt: s.updatedAt.toISOString(),
    ...(result ? { result } : {}),
    submittedAt: s.createdAt.toISOString(),
    context: deriveSubmissionContextKind(s),
  };
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
