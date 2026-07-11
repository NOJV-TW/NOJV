import { error, fail, type RequestEvent } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import { auditDomain, postDomain } from "@nojv/application";

const { listContentReports, resolveContentReport } = postDomain;

const PREVIEW_MAX_LENGTH = 100;

function requireAdmin(event: RequestEvent) {
  const actor = requireAuth(event);
  if (actor.platformRole !== "admin") {
    error(403, "Admin access required.");
  }
  return actor;
}

type Reports = Awaited<ReturnType<typeof listContentReports>>;

function describeTarget(report: Reports[number]) {
  if (report.post) {
    return {
      type: report.post.type,
      preview: report.post.title,
      postTitle: null,
      authorName: report.post.author.name,
      deleted: report.post.deletedAt !== null,
      problem: report.post.problem,
    };
  }
  if (report.comment) {
    const content = report.comment.content;
    return {
      type: "comment" as const,
      preview:
        content.length > PREVIEW_MAX_LENGTH
          ? `${content.slice(0, PREVIEW_MAX_LENGTH)}…`
          : content,
      postTitle: report.comment.post.title,
      authorName: report.comment.author.name,
      deleted: report.comment.deletedAt !== null,
      problem: report.comment.post.problem,
    };
  }
  return null;
}

export const load: PageServerLoad = async (event) => {
  const actor = requireAdmin(event);
  const reports = await listContentReports(actor, "open");
  return {
    reports: reports.flatMap((r) => {
      const target = describeTarget(r);
      if (!target) return [];
      return [
        {
          id: r.id,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
          reporterName: r.reportedBy.username ?? r.reportedBy.name,
          targetType: target.type,
          preview: target.preview,
          postTitle: target.postTitle,
          authorName: target.authorName,
          targetDeleted: target.deleted,
          problem: {
            id: target.problem.id,
            displayId: target.problem.displayId,
            title: target.problem.title,
          },
        },
      ];
    }),
  };
};

export const actions = {
  resolve: withAction(async (event) => {
    const actor = requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await resolveContentReport(actor, id, "resolve");
    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "content_report_resolve",
      targetType: "content_report",
      targetId: id,
      summary: id,
    });
    return { success: true };
  }),

  dismiss: withAction(async (event) => {
    const actor = requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await resolveContentReport(actor, id, "dismiss");
    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "content_report_dismiss",
      targetType: "content_report",
      targetId: id,
      summary: id,
    });
    return { success: true };
  }),
} satisfies Actions;
