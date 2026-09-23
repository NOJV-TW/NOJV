import { examSessionRepo, gradingRepo, problemRepo, submissionRepo } from "@nojv/db";
import {
  isSubmissionPending,
  languageSchema,
  submissionResultSchema,
  type SubmissionResult,
} from "@nojv/core";
import {
  assertStorageObjectPointer,
  getSubmissionSources as storageGetSubmissionSources,
  getVerdictDetail as storageGetVerdictDetail,
  type SubmissionSource,
} from "@nojv/storage";
import { activityScore, sumActivityScores } from "../scoring/activity-points";
import { computeProblemTotalScore } from "../problem/total-score";
import { assertProblemContentReadAccess, canProblemContentRead } from "../problem/permissions";
import type { ActorContext } from "../shared/actor-context";
import { ConflictError, IntegrityError, NotFoundError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import { canOperateOnSubmission } from "./permissions";
import { getSubmissionOperation } from "./operations";
import { buildSubmissionContext } from "./context";

function isFullPracticeReference(submission: {
  isReferenceSolution: boolean;
  sampleOnly: boolean;
  assessmentId: string | null;
  contestId: string | null;
  courseId: string | null;
  examId: string | null;
  participationId: string | null;
}): boolean {
  return (
    submission.isReferenceSolution &&
    !submission.sampleOnly &&
    submission.assessmentId === null &&
    submission.contestId === null &&
    submission.courseId === null &&
    submission.examId === null &&
    submission.participationId === null
  );
}

async function canReadReferenceSubmission(
  actor: ActorContext,
  submission: NonNullable<Awaited<ReturnType<typeof submissionRepo.findById>>>,
): Promise<boolean> {
  if (!isFullPracticeReference(submission)) return false;
  if (actor.platformRole !== "admin" && (await examSessionRepo.findActiveForUser(actor.userId)))
    return false;
  const problem = await problemRepo.findById(submission.problemId);
  return problem !== null && (await canProblemContentRead(problem, actor));
}

export async function getSubmissionForActor(actor: ActorContext, submissionId: string) {
  const submission = await submissionRepo.findByIdForUserRead({
    id: submissionId,
    userId: actor.userId,
    adminRecovery: actor.platformRole === "admin",
  });
  if (submission && !submission.isReferenceSolution) return submission;

  const reference = submission ?? (await submissionRepo.findById(submissionId));
  if (reference && (await canReadReferenceSubmission(actor, reference))) return reference;
  throw new NotFoundError("Submission not found.");
}

export async function getSubmissionById(id: string) {
  return submissionRepo.findById(id);
}

export async function getSubmissionSources(submissionId: string): Promise<SubmissionSource[]> {
  const submission = await submissionRepo.findById(submissionId);
  if (!submission) throw new NotFoundError("Submission not found.");
  return readSubmissionSources(submission.sourceStorage);
}

export async function getProblemReferenceSolution(actor: ActorContext, problemId: string) {
  const problem = await assertProblemContentReadAccess(actor, problemId);

  const [latestCandidate, candidate] = await Promise.all([
    submissionRepo.findLatestReferenceForProblem(problemId),
    problem.referenceSolutionSubmissionId
      ? submissionRepo.findById(problem.referenceSolutionSubmissionId)
      : null,
  ]);

  const latest =
    latestCandidate?.problemId === problemId && isFullPracticeReference(latestCandidate)
      ? latestCandidate
      : null;
  const verified =
    candidate?.problemId === problemId &&
    isFullPracticeReference(candidate) &&
    candidate.status === "accepted" &&
    candidate.referenceProblemStorageGeneration === problem.storageGeneration &&
    candidate.sourceStorage !== null
      ? candidate
      : null;

  const status =
    latest && isSubmissionPending(latest.status)
      ? ("validating" as const)
      : verified
        ? ("verified" as const)
        : latest === null
          ? ("not_configured" as const)
          : ("failed" as const);
  const sourceFiles =
    status === "verified" && verified?.sourceStorage
      ? await readSubmissionSources(verified.sourceStorage)
      : [];

  return {
    status,
    submissionId:
      status === "validating" ? (latest?.id ?? null) : (verified?.id ?? latest?.id ?? null),
    language: verified?.language ?? latest?.language ?? null,
    sourceFiles,
    lastSubmission: latest
      ? {
          id: latest.id,
          status: latest.status,
          judgeGeneration: latest.judgeGeneration,
          updatedAt: latest.updatedAt.toISOString(),
          score: latest.score,
          runtimeMs: latest.runtimeMs,
          memoryKb: latest.memoryKb,
          createdAt: latest.createdAt,
        }
      : null,
  };
}

export async function getVerdictDetail(submissionId: string): Promise<SubmissionResult> {
  const submission = await submissionRepo.findById(submissionId);
  if (!submission) throw new NotFoundError("Submission not found.");
  if (submission.verdictDetailStorage === null) {
    throw new NotFoundError("Submission verdict detail not found.");
  }
  return readVerdictDetail(submission.verdictDetailStorage);
}

async function readSubmissionSources(pointer: unknown): Promise<SubmissionSource[]> {
  if (pointer === null) {
    throw new ConflictError("Submission source is not available.");
  }
  return storageGetSubmissionSources(storage(), assertStorageObjectPointer(pointer));
}

export async function readVerdictDetail(pointer: unknown): Promise<SubmissionResult> {
  const raw = await storageGetVerdictDetail(storage(), assertStorageObjectPointer(pointer));
  const parsed = submissionResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IntegrityError(
      `Persisted verdict detail is malformed: ${parsed.error.issues
        .map((issue) => issue.path.join(".") || issue.code)
        .join(", ")}`,
    );
  }
  return parsed.data;
}

export async function getSubmissionDetail(actor: ActorContext, submissionId: string) {
  let submission = await submissionRepo.findByIdForDetail({
    id: submissionId,
    userId: actor.userId,
    adminRecovery: actor.platformRole === "admin",
  });

  let viewerIsStaff = false;
  if (!submission && actor.platformRole !== "admin") {
    const candidate = await submissionRepo.findByIdForStaffDetailCandidate(submissionId);
    if (candidate) {
      const record = await submissionRepo.findById(submissionId);
      const allowed = record?.isReferenceSolution
        ? await canReadReferenceSubmission(actor, record)
        : candidate.userId !== actor.userId && (await canOperateOnSubmission(actor, candidate));
      if (allowed) {
        submission = candidate;
        viewerIsStaff = true;
      }
    }
  }
  if (!submission) throw new NotFoundError("Submission not found.");

  const isOwner = submission.userId === actor.userId;
  if (!isOwner && !viewerIsStaff) {
    viewerIsStaff = await canOperateOnSubmission(actor, submission);
  }

  if (!isOwner && !viewerIsStaff) {
    throw new NotFoundError("Submission not found.");
  }

  const language = languageSchema.parse(submission.language);

  const [operation, sources] = await Promise.all([
    getSubmissionOperation(actor, submissionId, true, viewerIsStaff),
    submission.sourceStorage
      ? readSubmissionSources(submission.sourceStorage)
      : Promise.resolve([]),
  ]);
  const result = operation.result;
  const pending = isSubmissionPending(operation.status);

  const allocation = submission.sampleOnly
    ? null
    : await gradingRepo.findAllocation(
        { assessmentId: submission.assessmentId, examId: submission.examId },
        submission.problemId,
      );
  const rawMax = computeProblemTotalScore({
    id: submission.problem.id,
    type: submission.problem.type,
    testcaseSets: submission.problem.testcaseSets,
    advancedConfig: submission.problem.advancedConfig,
  });
  return {
    activityContribution:
      !pending && allocation
        ? {
            score: sumActivityScores([
              activityScore(operation.result?.score ?? 0, rawMax, allocation.points),
            ]),
            points: Number(allocation.points),
          }
        : null,
    id: submission.id,
    createdAt: submission.createdAt.toISOString(),
    language,
    sources,
    status: operation.status,
    judgeGeneration: operation.judgeGeneration,
    updatedAt: operation.updatedAt,
    score: pending ? null : (operation.result?.score ?? null),
    runtimeMs: pending ? null : (operation.result?.runtimeMs ?? null),
    memoryKb: pending ? null : (operation.result?.memoryKb ?? null),
    sampleOnly: submission.sampleOnly,
    result,
    problem: {
      id: submission.problem.id,
      displayId: submission.problem.displayId,
      title: submission.problem.title,
    },
    totalScore: computeProblemTotalScore({
      id: submission.problem.id,
      type: submission.problem.type,
      testcaseSets: submission.problem.testcaseSets,
      advancedConfig: submission.problem.advancedConfig,
    }),
    context: buildSubmissionContext(submission),
    submitter: viewerIsStaff
      ? { name: submission.user.name, username: submission.user.username }
      : null,
    viewerIsStaff,
    feedbackStudentUserId: submission.userId,
  };
}
