import { contentReportRepo, postRepo } from "@nojv/db";

import * as notificationDomain from "../notification";
import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";

export type ContentReportStatus = "open" | "resolved" | "dismissed";
export type ContentReportAction = "resolve" | "dismiss";

const REASON_MAX_LENGTH = 1000;

export async function reportPost(actor: ActorContext, postId: string, reason: string) {
  const post = await postRepo.findById(postId);
  if (!post || post.deletedAt) {
    throw new NotFoundError("Post not found.");
  }

  if (actor.userId === post.authorId) {
    throw new ValidationError("You cannot report your own post.");
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("A report reason is required.");
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    throw new ValidationError("Report reason must be at most 1000 characters.");
  }

  try {
    return await contentReportRepo.create({
      postId,
      reportedByUserId: actor.userId,
      reason: trimmed,
    });
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "P2002") {
      throw new ConflictError("You have already reported this post.");
    }
    throw err;
  }
}

export async function listContentReports(
  actor: ActorContext,
  status: ContentReportStatus = "open",
) {
  if (actor.platformRole !== "admin") {
    throw new ForbiddenError("Admin access required.");
  }
  return contentReportRepo.listByStatus(status);
}

export async function resolveContentReport(
  actor: ActorContext,
  reportId: string,
  action: ContentReportAction,
) {
  if (actor.platformRole !== "admin") {
    throw new ForbiddenError("Admin access required.");
  }

  const report = await contentReportRepo.findById(reportId);
  if (!report) {
    throw new NotFoundError("Content report not found.");
  }

  if (action === "resolve" && report.postId) {
    const post = await postRepo.findById(report.postId);
    await postRepo.softDelete(report.postId);

    if (post && !post.deletedAt) {
      await notificationDomain
        .createNotification({
          userId: post.authorId,
          type: "editorial_removed",
          params: { problemId: post.problemId, title: post.title },
          linkUrl: `/problems/${post.problemId}`,
        })
        .catch(() => undefined);
    }
  }

  return contentReportRepo.updateStatus(reportId, {
    status: action === "resolve" ? "resolved" : "dismissed",
    resolvedByUserId: actor.userId,
    resolvedAt: new Date(),
  });
}
