import { editorialRepo, editorialReportRepo } from "@nojv/db";

import * as notificationDomain from "../notification";
import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";

export type EditorialReportStatus = "open" | "resolved" | "dismissed";
export type EditorialReportAction = "resolve" | "dismiss";

const REASON_MAX_LENGTH = 1000;

export async function reportEditorial(
  actor: ActorContext,
  editorialId: string,
  reason: string,
) {
  const editorial = await editorialRepo.findById(editorialId);
  if (!editorial || editorial.deletedAt) {
    throw new NotFoundError("Editorial not found.");
  }

  if (actor.userId === editorial.userId) {
    throw new ValidationError("You cannot report your own editorial.");
  }

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("A report reason is required.");
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    throw new ValidationError("Report reason must be at most 1000 characters.");
  }

  try {
    return await editorialReportRepo.create({
      editorialId,
      reportedByUserId: actor.userId,
      reason: trimmed,
    });
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "P2002") {
      throw new ConflictError("You have already reported this editorial.");
    }
    throw err;
  }
}

export async function listEditorialReports(
  actor: ActorContext,
  status: EditorialReportStatus = "open",
) {
  if (actor.platformRole !== "admin") {
    throw new ForbiddenError("Admin access required.");
  }
  return editorialReportRepo.listByStatus(status);
}

export async function resolveEditorialReport(
  actor: ActorContext,
  reportId: string,
  action: EditorialReportAction,
) {
  if (actor.platformRole !== "admin") {
    throw new ForbiddenError("Admin access required.");
  }

  const report = await editorialReportRepo.findById(reportId);
  if (!report) {
    throw new NotFoundError("Editorial report not found.");
  }

  if (action === "resolve") {
    const editorial = await editorialRepo.findById(report.editorialId);
    await editorialRepo.softDelete(report.editorialId);

    if (editorial && !editorial.deletedAt) {
      await notificationDomain
        .createNotification({
          userId: editorial.userId,
          type: "editorial_removed",
          params: { problemId: editorial.problemId, title: editorial.title },
          linkUrl: `/problems/${editorial.problemId}`,
        })
        .catch(() => undefined);
    }
  }

  return editorialReportRepo.updateStatus(reportId, {
    status: action === "resolve" ? "resolved" : "dismissed",
    resolvedByUserId: actor.userId,
    resolvedAt: new Date(),
  });
}
