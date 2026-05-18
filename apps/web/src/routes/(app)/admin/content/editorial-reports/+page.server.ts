import { error, fail, type RequestEvent } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import { editorialDomain } from "@nojv/domain";

const { listEditorialReports, resolveEditorialReport } = editorialDomain;

// Layout-level guard only runs on GET loads; POST actions can be called
// directly. Re-derive auth + admin role inside every action.
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
  resolve: withRateLimit(async (event) => {
    const actor = requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await resolveEditorialReport(actor, id, "resolve");
    return { success: true };
  }),

  dismiss: withRateLimit(async (event) => {
    const actor = requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });

    await resolveEditorialReport(actor, id, "dismiss");
    return { success: true };
  }),
} satisfies Actions;
