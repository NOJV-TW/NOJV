import { contentReportRepo, postCommentRepo, postRepo } from "@nojv/db";

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
export type ContentReportTarget = { postId: string } | { commentId: string };

const REASON_MAX_LENGTH = 1000;

export async function reportContent(
  actor: ActorContext,
  target: ContentReportTarget,
  reason: string,
) {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("A report reason is required.");
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    throw new ValidationError("Report reason must be at most 1000 characters.");
  }

  if ("postId" in target) {
    const post = await postRepo.findById(target.postId);
    if (!post || post.deletedAt) {
      throw new NotFoundError("Post not found.");
    }
    if (post.authorId === actor.userId) {
      throw new ForbiddenError("You cannot report your own post.");
    }
  } else {
    const comment = await postCommentRepo.findById(target.commentId);
    if (!comment || comment.deletedAt) {
      throw new NotFoundError("Comment not found.");
    }
    if (comment.authorId === actor.userId) {
      throw new ForbiddenError("You cannot report your own comment.");
    }
  }

  try {
    return await contentReportRepo.create({
      ...target,
      reportedByUserId: actor.userId,
      reason: trimmed,
    });
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "P2002") {
      throw new ConflictError("You have already reported this content.");
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
  if (report.status !== "open") {
    throw new ConflictError("This report has already been handled.");
  }

  if (action === "resolve") {
    if (report.post) {
      const deleted = await postRepo.softDeleteIfActive(report.post.id);
      if (deleted === 1) {
        await notificationDomain
          .createNotification({
            userId: report.post.authorId,
            type: "post_removed",
            params: { problemId: report.post.problemId, title: report.post.title },
            linkUrl: `/problems/${report.post.problemId}`,
          })
          .catch(() => undefined);
      }
    } else if (report.comment) {
      const deleted = await postCommentRepo.softDeleteIfActive(report.comment.id);
      if (deleted === 1) {
        await notificationDomain
          .createNotification({
            userId: report.comment.authorId,
            type: "comment_removed",
            params: {
              problemId: report.comment.post.problemId,
              postTitle: report.comment.post.title,
            },
            linkUrl: `/problems/${report.comment.post.problemId}`,
          })
          .catch(() => undefined);
      }
    }
  }

  return contentReportRepo.updateStatus(reportId, {
    status: action === "resolve" ? "resolved" : "dismissed",
    resolvedByUserId: actor.userId,
    resolvedAt: new Date(),
  });
}
