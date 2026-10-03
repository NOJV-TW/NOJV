import { createJudgeExecution } from "./judge-execution";
import { prepareJudgeSnapshot } from "./judge-snapshot";
import { dispatchNextJudgeExecutions, reconcileJudgeExecutions } from "./judge-recovery";
import { findOneForRejudge, listForRejudge } from "./judge-context";
import { randomUUID } from "node:crypto";

import type { RejudgeInput, RejudgeProgress, RejudgeTrackingProgress } from "@nojv/core";
import { submissionOperationStatusSchema } from "@nojv/core";
import {
  assessmentRepo,
  contestRepo,
  courseRepo,
  durableWorkRepo,
  examRepo,
  prismaAdapterClient as db,
  type TransactionClient,
} from "@nojv/db";
import { z } from "zod";

import {
  ConflictError,
  ForbiddenError,
  IntegrityError,
  NotFoundError,
  ServiceUnavailableError,
} from "../shared/errors";
import type { ActorContext } from "../shared/actor-context";
import { toJsonValue } from "../shared/to-json-value";
import { assertBatchRejudgeAccess, assertCanOperateOnSubmission } from "./permissions";

const REJUDGE_WORKFLOW_PREFIX = "rejudge-";
export const REJUDGE_DISPATCH_WORK_KIND = "submission.rejudge.dispatch";

const rejudgeInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("single"),
      submissionId: z.string().min(1),
      triggeredByUserId: z.string().min(1).nullable(),
      expectedJudgeGeneration: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("batch"),
      problemId: z.string().min(1),
      contestId: z.string().min(1).optional(),
      assessmentId: z.string().min(1).optional(),
      examId: z.string().min(1).optional(),
      userIds: z.array(z.string().min(1)).optional(),
      since: z.iso.datetime().optional(),
      until: z.iso.datetime().optional(),
      triggeredByUserId: z.string().min(1),
    })
    .strict(),
]);

const rejudgeDispatchPayloadSchema = z
  .object({
    input: rejudgeInputSchema,
    prepared: z.literal(true).optional(),
    workflowId: z.string().startsWith(REJUDGE_WORKFLOW_PREFIX),
  })
  .strict();

const terminalProgressSchema = z.object({
  status: z.enum(["completed", "failed", "cancelled"]),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const terminalTrackingProgressSchema = terminalProgressSchema.extend({
  targets: z
    .array(
      z.object({ submissionId: z.string(), judgeGeneration: z.number().int().nonnegative() }),
    )
    .nullable()
    .optional(),
});

export function assertRejudgeWorkflowId(workflowId: string): void {
  if (
    !workflowId.startsWith(REJUDGE_WORKFLOW_PREFIX) ||
    workflowId.length > 256 ||
    workflowId !== workflowId.trim()
  ) {
    throw new NotFoundError("Rejudge not found.");
  }
}

type RejudgeActor = Pick<ActorContext, "userId" | "platformRole">;

async function requireRejudge(actor: RejudgeActor, workflowId: string) {
  assertRejudgeWorkflowId(workflowId);
  let work;
  try {
    work = await durableWorkRepo.findByWorkflowId(REJUDGE_DISPATCH_WORK_KIND, workflowId);
  } catch (cause) {
    throw new ServiceUnavailableError("Unable to read rejudge status. Please retry.", {
      cause,
    });
  }
  if (!work) throw new NotFoundError("Rejudge not found.");
  const payload = rejudgeDispatchPayloadSchema.safeParse(work.payload);
  if (!payload.success) {
    throw new IntegrityError(
      `Invalid rejudge dispatch payload for ${workflowId}: ${payload.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (actor.platformRole !== "admin" && payload.data.input.triggeredByUserId !== actor.userId) {
    throw new ForbiddenError("Only the rejudge requester or an administrator may access it.");
  }
  return work;
}

function rejudgeProgressStatus(
  runs: { state: string }[],
  completed: number,
  terminal: boolean,
): RejudgeProgress["status"] {
  if (completed === runs.length) return "completed";
  if (terminal) return "cancelled";
  return runs.every((run) => run.state === "queued") ? "queued" : "running";
}

export async function queryRejudgeProgress(
  actor: RejudgeActor,
  workflowId: string,
): Promise<RejudgeProgress> {
  const work = await requireRejudge(actor, workflowId);
  const cached = terminalProgressSchema.safeParse(work.result);
  if (cached.success) return cached.data;
  const payload = rejudgeDispatchPayloadSchema.parse(work.payload);
  if (!payload.prepared) throw new NotFoundError("Rejudge workflow is no longer available.");
  const runs = await db.judgeExecution.findMany({
    where: { operationId: workflowId },
    select: { state: true },
  });
  const completed = runs.filter((run) => run.state === "completed").length;
  const terminal = runs.every((run) => ["completed", "cancelled"].includes(run.state));
  const progress: RejudgeProgress = {
    status: rejudgeProgressStatus(runs, completed, terminal),
    completed,
    total: runs.length,
  };
  if (terminal) await durableWorkRepo.recordRejudgeProgress(workflowId, toJsonValue(progress));
  return progress;
}

export async function listActiveRejudges(
  actor: RejudgeActor,
  input: {
    problemId: string;
    scope: { contestId?: string; assessmentId?: string; examId?: string };
  },
) {
  const rows = await durableWorkRepo.listRejudgeCandidates({
    problemId: input.problemId,
    ...(actor.platformRole === "admin" ? {} : { requesterId: actor.userId }),
  });
  const items = [];
  for (const row of rows) {
    const parsed = rejudgeDispatchPayloadSchema.parse(row.payload);
    if (parsed.input.mode !== "batch") continue;
    if (
      parsed.input.contestId !== input.scope.contestId ||
      parsed.input.assessmentId !== input.scope.assessmentId ||
      parsed.input.examId !== input.scope.examId
    )
      continue;
    try {
      const progress = await queryRejudgeProgress(actor, parsed.workflowId);
      if (progress.status === "queued" || progress.status === "running")
        items.push({ workflowId: parsed.workflowId, ...progress });
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return { items };
}

export async function queuedRejudges(input: {
  submissionIds?: string[];
  userId?: string;
  context?: { type: "assignment" | "exam" | "contest"; id: string };
}) {
  const rows = await durableWorkRepo.listQueuedRejudges(input);
  const queued = new Map<string, { pending: boolean; updatedAt: Date }>();
  const progressByWorkflow = new Map<string, RejudgeTrackingProgress | null>();
  const targetsByWorkflow = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const parsed = rejudgeDispatchPayloadSchema.parse(row.payload);
    if (queued.has(row.submissionId)) continue;
    let progress = progressByWorkflow.get(parsed.workflowId);
    if (progress === undefined) {
      progress = (() => {
        if (row.status === "pending" && row.attempt === 0)
          return { status: "queued", completed: 0, total: 0 } as const;
        if (row.status === "cancelled" || row.status === "dead")
          return {
            status: row.status === "dead" ? "failed" : "cancelled",
            completed: 0,
            total: 0,
          } as const;
        const terminal = terminalTrackingProgressSchema.safeParse(row.result);
        if (terminal.success) {
          const { targets, ...counts } = terminal.data;
          return { ...counts, ...(targets === undefined ? {} : { targets }) };
        }
        return null;
      })();
      progressByWorkflow.set(parsed.workflowId, progress);
    }
    let pending =
      progress?.status === "queued" ||
      progress?.status === "running" ||
      (!progress && (row.status === "pending" || row.status === "leased"));
    if (parsed.input.mode === "batch" && pending && progress?.targets) {
      let targets = targetsByWorkflow.get(parsed.workflowId);
      if (!targets) {
        targets = new Map(
          progress.targets.map((target) => [target.submissionId, target.judgeGeneration]),
        );
        targetsByWorkflow.set(parsed.workflowId, targets);
      }
      pending = targets.get(row.submissionId) === row.submissionGeneration;
    }
    queued.set(row.submissionId, {
      pending,
      updatedAt: new Date(Math.max(row.updatedAt.getTime(), row.submissionUpdatedAt.getTime())),
    });
  }
  return queued;
}

export async function cancelRejudge(
  actor: RejudgeActor,
  workflowId: string,
): Promise<{ status: "requested" | "completed" | "failed" | "cancelled" }> {
  const work = await requireRejudge(actor, workflowId);
  if (!rejudgeDispatchPayloadSchema.parse(work.payload).prepared) {
    const cached = terminalProgressSchema.safeParse(work.result);
    if (cached.success) return { status: cached.data.status };
    throw new NotFoundError("Rejudge workflow is no longer available.");
  }
  const rows = await db.judgeExecution.findMany({
    where: { operationId: workflowId },
    orderBy: { submissionId: "asc" },
  });
  const affectedUsers = new Set<string>();
  const cancelled = await db.$transaction(async (tx) => {
    let count = 0;
    for (const selected of rows) {
      await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${selected.submissionId} FOR UPDATE`;
      const run = await tx.judgeExecution.findUniqueOrThrow({ where: { id: selected.id } });
      const submission = await tx.submission.findUniqueOrThrow({
        where: { id: run.submissionId },
      });
      if (["completed", "cancelled"].includes(run.state)) continue;
      if (
        run.state === "finalizing" &&
        submission.activeJudgeRunId === null &&
        submission.judgeGeneration === run.generation
      )
        continue;
      await tx.judgeExecution.update({ where: { id: run.id }, data: { state: "cancelled" } });
      affectedUsers.add(submission.userId);
      count++;
      await tx.submission.updateMany({
        where: {
          id: run.submissionId,
          judgeGeneration: run.generation,
          activeJudgeRunId: run.workflowId,
        },
        data: {
          activeJudgeRunId: null,
          status: submissionOperationStatusSchema.parse(run.oldStatus),
          score: run.oldScore,
        },
      });
    }
    await durableWorkRepo.withTx(tx).cancel({
      kind: REJUDGE_DISPATCH_WORK_KIND,
      dedupeKey: work.dedupeKey,
      now: new Date(),
    });
    return count;
  });
  for (const userId of affectedUsers) await dispatchNextJudgeExecutions(userId);
  if (cancelled || rows.some((run) => run.state === "cancelled"))
    return { status: "cancelled" };
  return { status: rows.every((run) => run.state === "completed") ? "completed" : "requested" };
}

async function requireRejudgeTarget(submissionId: string) {
  const target = await findOneForRejudge(submissionId);
  if (!target)
    throw new ConflictError(
      "This submission cannot be rejudged: it is a reference solution or is still being judged.",
    );
  return target;
}

interface RejudgeScope {
  contestId?: string | null;
  assessmentId?: string | null;
  examId?: string | null;
}

async function lockRejudgeScopes(
  tx: TransactionClient,
  actor: RejudgeActor,
  scopes: RejudgeScope[],
) {
  const assessments = new Set(
    scopes.flatMap((scope) => (scope.assessmentId ? [scope.assessmentId] : [])),
  );
  const exams = new Set(scopes.flatMap((scope) => (scope.examId ? [scope.examId] : [])));
  const contexts = [];
  for (const id of [...assessments].sort()) {
    const current = await assessmentRepo.withTx(tx).findById(id);
    if (!current) throw new NotFoundError("Assignment not found.");
    contexts.push({ type: "assignment" as const, id, courseId: current.courseId });
  }
  for (const id of [...exams].sort()) {
    const current = await examRepo.withTx(tx).findById(id);
    if (!current) throw new NotFoundError("Exam not found.");
    contexts.push({ type: "exam" as const, id, courseId: current.courseId });
  }
  const courseIds = [...new Set(contexts.map((context) => context.courseId))].sort();
  for (const courseId of courseIds) await courseRepo.withTx(tx).lockForUpdate(courseId);
  for (const courseId of courseIds)
    await tx.$queryRaw`SELECT id FROM "CourseMembership" WHERE "courseId" = ${courseId} AND "userId" = ${actor.userId} FOR UPDATE`;
  for (const context of contexts) {
    const repo =
      context.type === "assignment" ? assessmentRepo.withTx(tx) : examRepo.withTx(tx);
    await repo.lockForUpdate(context.id);
    const current = await repo.findById(context.id);
    if (current?.courseId !== context.courseId)
      throw new ConflictError("Rejudge scope changed during preparation. Please retry.");
  }
  for (const id of [
    ...new Set(scopes.flatMap((scope) => (scope.contestId ? [scope.contestId] : []))),
  ].sort())
    await contestRepo.withTx(tx).lockForUpdate(id);
}

export async function dispatchRejudge(
  input: RejudgeInput,
  actor: RejudgeActor,
): Promise<{ workflowId: string }> {
  const workflowId = `${REJUDGE_WORKFLOW_PREFIX}${randomUUID()}`;
  rejudgeInputSchema.parse(input);
  if (!input.triggeredByUserId || input.triggeredByUserId !== actor.userId)
    throw new ForbiddenError("Only an explicit teacher rejudge selects a new version.");
  const triggeredByUserId = input.triggeredByUserId;
  const targets =
    input.mode === "single"
      ? [await requireRejudgeTarget(input.submissionId)]
      : await listForRejudge({
          problemId: input.problemId,
          ...(input.contestId ? { contestId: input.contestId } : {}),
          ...(input.assessmentId ? { assignmentId: input.assessmentId } : {}),
          ...(input.examId ? { examId: input.examId } : {}),
          ...(input.userIds ? { userIds: input.userIds } : {}),
          ...(input.since ? { since: new Date(input.since) } : {}),
          ...(input.until ? { until: new Date(input.until) } : {}),
        });
  const selected = await db.submission.findMany({
    where: { id: { in: targets.map((target) => target.submissionId) } },
    select: {
      id: true,
      userId: true,
      problemId: true,
      contestId: true,
      assessmentId: true,
      examId: true,
    },
  });
  const selectedById = new Map(selected.map((submission) => [submission.id, submission]));
  if (selected.length !== targets.length)
    throw new ConflictError("Rejudge targets changed during preparation. Please retry.");
  if (input.mode === "batch") await assertBatchRejudgeAccess(actor, input);
  for (const submission of selected) await assertCanOperateOnSubmission(actor, submission);
  const prepared: {
    target: (typeof targets)[number];
    snapshot: Awaited<ReturnType<typeof prepareJudgeSnapshot>>;
  }[] = [];
  for (const target of targets)
    prepared.push({
      target,
      snapshot: await prepareJudgeSnapshot(target.submissionId, target.draft),
    });
  const versions = new Map<string, number>();
  for (const item of prepared) {
    const previous = versions.get(item.target.draft.problemId);
    if (previous !== undefined && previous !== item.snapshot.problemGeneration)
      throw new ServiceUnavailableError(
        "Problem changed during batch preparation. Please retry.",
      );
    versions.set(item.target.draft.problemId, item.snapshot.problemGeneration);
  }
  await db.$transaction(
    async (tx) => {
      await lockRejudgeScopes(tx, actor, [
        ...selected,
        ...(input.mode === "batch" ? [input] : []),
      ]);
      const problemIds = new Set([
        ...versions.keys(),
        ...(input.mode === "batch" ? [input.problemId] : []),
      ]);
      for (const problemId of [...problemIds].sort()) {
        await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problemId} FOR UPDATE`;
        const current = await tx.problem.findUniqueOrThrow({
          where: { id: problemId },
          select: { storageGeneration: true },
        });
        const generation = versions.get(problemId);
        if (generation !== undefined && current.storageGeneration !== generation)
          throw new ServiceUnavailableError(
            "Problem changed during batch preparation. Please retry.",
          );
      }
      if (input.mode === "batch") await assertBatchRejudgeAccess(actor, input, tx);
      for (const item of [...prepared].sort((a, b) =>
        a.target.submissionId.localeCompare(b.target.submissionId),
      )) {
        const submissionId = item.target.submissionId;
        await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
        const current = await tx.submission.findUniqueOrThrow({ where: { id: submissionId } });
        const original = selectedById.get(submissionId);
        if (
          current.problemId !== original?.problemId ||
          current.userId !== original.userId ||
          current.contestId !== original.contestId ||
          current.assessmentId !== original.assessmentId ||
          current.examId !== original.examId ||
          current.problemId !== item.target.draft.problemId ||
          current.userId !== item.target.studentId ||
          (input.mode === "batch" &&
            ((input.contestId && current.contestId !== input.contestId) ||
              (input.assessmentId && current.assessmentId !== input.assessmentId) ||
              (input.examId && current.examId !== input.examId)))
        )
          throw new ConflictError("Rejudge scope changed during preparation. Please retry.");
        if (
          current.isReferenceSolution ||
          ["pending_upload", "queued", "compiling", "running"].includes(current.status)
        )
          throw new ConflictError("Rejudge target changed during preparation. Please retry.");
        await assertCanOperateOnSubmission(actor, current, tx);
      }
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.userId} FOR SHARE`;
      const requester = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { disabled: true, platformRole: true },
      });
      if (
        !requester ||
        requester.disabled ||
        (actor.platformRole === "admin" && requester.platformRole !== "admin")
      )
        throw new ForbiddenError("Rejudge requester no longer has permission.");
      for (const item of prepared)
        await createJudgeExecution(tx, {
          submissionId: item.target.submissionId,
          ...item.snapshot,
          operationId: workflowId,
          triggeredByUserId,
        });
      await durableWorkRepo.withTx(tx).enqueue({
        kind: REJUDGE_DISPATCH_WORK_KIND,
        dedupeKey: workflowId,
        payload: toJsonValue({ input, workflowId, prepared: true }),
        maxAttempts: 20,
      });
    },
    { timeout: 60_000 },
  );
  return { workflowId };
}

export async function recoverSystemErrorSubmissions(): Promise<number> {
  return reconcileJudgeExecutions();
}

export function executeRejudgeDispatch(rawPayload: unknown): Promise<void> {
  rejudgeDispatchPayloadSchema.parse(rawPayload);
  return Promise.resolve();
}
