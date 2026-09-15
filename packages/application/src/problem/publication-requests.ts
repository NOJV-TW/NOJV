import { problemPublicationRequestRepo, problemRepo, runTransaction } from "@nojv/db";

import { recordAdminAudit } from "../audit";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";

import { assertProblemPublishable } from "./mutations";
import type { ProblemActorContext } from "./permissions";
import { canRequestPublicProblemPublication } from "./permissions";
import { forkProblemInTransaction } from "./fork";

export type ProblemPublicationRequestStatus = "pending" | "approved" | "rejected";

function assertAdmin(actor: ProblemActorContext): void {
  if (actor.platformRole !== "admin") throw new ForbiddenError("Admin access required.");
}

export async function requestPublicProblemPublication(
  actor: ProblemActorContext,
  problemId: string,
) {
  if (!(await canRequestPublicProblemPublication(actor))) {
    throw new ForbiddenError(
      "Only active course staff can request public publication of a problem.",
    );
  }

  try {
    return await runTransaction(async (tx) => {
      const problems = problemRepo.withTx(tx);
      await problems.lockForUpdate(problemId);
      const problem = await problems.findById(problemId);
      if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
      if (problem.authorId !== actor.userId) {
        throw new ForbiddenError("Only the problem owner can request public publication.");
      }
      if (problem.visibility !== "private") {
        throw new ConflictError("Only private problems can be submitted for public review.");
      }

      const requests = problemPublicationRequestRepo.withTx(tx);
      if (await requests.findPendingByProblemId(problemId)) {
        throw new ConflictError("A publication request for this problem is already pending.");
      }
      return requests.createPending({ problemId, requestedByUserId: actor.userId });
    });
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === "P2002") {
      throw new ConflictError("A publication request for this problem is already pending.");
    }
    throw error;
  }
}

export async function getLatestPublicProblemPublicationRequest(
  actor: ProblemActorContext,
  problemId: string,
) {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
    throw new ForbiddenError(
      "Only the problem owner or an admin can view publication requests.",
    );
  }
  return problemPublicationRequestRepo.findLatestByProblemId(problemId);
}

export async function listPublicProblemPublicationRequests(
  actor: ProblemActorContext,
  opts: {
    status?: ProblemPublicationRequestStatus;
    limit?: number;
    cursor?: string;
  },
) {
  assertAdmin(actor);
  const limit = opts.limit ?? 50;
  const rows = await problemPublicationRequestRepo.listPaged({
    ...(opts.status ? { status: opts.status } : {}),
    limit,
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export async function approvePublicProblemPublication(
  actor: ProblemActorContext,
  requestId: string,
) {
  assertAdmin(actor);

  const result = await runTransaction(async (tx) => {
    const requests = problemPublicationRequestRepo.withTx(tx);
    await requests.lockById(requestId);
    const request = await requests.findById(requestId);
    if (!request) throw new NotFoundError(`Publication request not found: ${requestId}`);
    if (request.status !== "pending") {
      throw new ConflictError("Only pending publication requests can be approved.");
    }

    const problems = problemRepo.withTx(tx);
    await problems.lockForUpdate(request.problemId);
    const source = await problems.findById(request.problemId);
    if (!source) throw new NotFoundError(`Problem not found: ${request.problemId}`);
    if (source.visibility !== "private") {
      throw new ConflictError("Only private problems can be approved for public publication.");
    }
    if (source.authorId !== request.requestedByUserId) {
      throw new ConflictError("The request no longer matches the problem owner.");
    }

    await assertProblemPublishable(tx, source);
    const publishedFork = await forkProblemInTransaction(tx, source.id, {
      authorId: actor.userId,
      published: true,
      requirePublishedPublicSource: false,
    });
    await requests.approve(request.id, {
      publishedProblemId: publishedFork.id,
      reviewedByUserId: actor.userId,
      reviewedAt: new Date(),
    });
    return { id: publishedFork.id, requestId: request.id, title: source.title };
  });

  await recordAdminAudit({
    actorId: actor.userId,
    actorName: actor.username,
    action: "problem_publication_approve",
    targetType: "problem_publication_request",
    targetId: result.requestId,
    summary: `Approved public publication for ${result.title} (${result.id}).`,
  });
  return { id: result.id, requestId: result.requestId };
}

export async function rejectPublicProblemPublication(
  actor: ProblemActorContext,
  requestId: string,
  reviewNote?: string,
) {
  assertAdmin(actor);

  const result = await runTransaction(async (tx) => {
    const requests = problemPublicationRequestRepo.withTx(tx);
    await requests.lockById(requestId);
    const request = await requests.findById(requestId);
    if (!request) throw new NotFoundError(`Publication request not found: ${requestId}`);
    if (request.status !== "pending") {
      throw new ConflictError("Only pending publication requests can be rejected.");
    }
    const trimmedNote = reviewNote?.trim();
    const note = trimmedNote && trimmedNote.length > 0 ? trimmedNote : null;
    return requests.reject(request.id, {
      reviewedByUserId: actor.userId,
      reviewNote: note,
      reviewedAt: new Date(),
    });
  });

  await recordAdminAudit({
    actorId: actor.userId,
    actorName: actor.username,
    action: "problem_publication_reject",
    targetType: "problem_publication_request",
    targetId: result.id,
    summary: `Rejected public publication request ${result.id}.`,
  });
  return { id: result.id, status: result.status };
}
