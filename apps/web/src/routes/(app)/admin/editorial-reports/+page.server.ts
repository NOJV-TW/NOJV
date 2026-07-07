import { error, fail, type RequestEvent } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import { auditDomain, editorialDomain } from "@nojv/application";

const { listEditorialReports, resolveEditorialReport } = editorialDomain;

function requireAdmin(event: RequestEvent) {
  const actor = requireAuth(event);
  if (actor.platformRole !== "admin") {
    error(403, "Admin access required.");
  }
  return actor;
}

export const load: PageServerLoad = async (event) => {
  const actor = requireAdmin(event);
  const reports = await listEditorialReports(actor, "open");
  return {
    reports: reports.map((r) => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      editorialDeleted: r.editorial.deletedAt !== null,
      problem: {
        displayId: r.editorial.problem.displayId,
        title: r.editorial.problem.title,
      },
      authorName: r.editorial.user.name,
      reporterName: r.reportedBy.displayUsername ?? r.reportedBy.name,
    })),
  };
};

export const actions = {
  resolve: withAction(async (event) => {
    const actor = requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await resolveEditorialReport(actor, id, "resolve");
    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "editorial_report_resolve",
      targetType: "editorial_report",
      targetId: id,
      summary: id,
    });
    return { success: true };
  }),

  dismiss: withAction(async (event) => {
    const actor = requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await resolveEditorialReport(actor, id, "dismiss");
    await auditDomain.recordAdminAudit({
      actorId: actor.userId,
      actorName: actor.displayName,
      action: "editorial_report_dismiss",
      targetType: "editorial_report",
      targetId: id,
      summary: id,
    });
    return { success: true };
  }),
} satisfies Actions;
