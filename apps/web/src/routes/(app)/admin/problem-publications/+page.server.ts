import { error, fail, type RequestEvent } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import { problemDomain } from "@nojv/application";

function requireAdmin(event: RequestEvent) {
  const actor = requireAuth(event);
  if (actor.platformRole !== "admin") error(403, "Admin access required.");
  return actor;
}

function parseStatus(value: string | null) {
  return value === "pending" || value === "approved" || value === "rejected"
    ? value
    : undefined;
}

export const load: PageServerLoad = async (event) => {
  const actor = requireAdmin(event);
  const status = parseStatus(event.url.searchParams.get("status"));
  const result = await problemDomain.listPublicProblemPublicationRequests(actor, {
    ...(status ? { status } : {}),
    limit: 100,
  });

  return {
    status: status ?? "all",
    nextCursor: result.nextCursor,
    requests: result.items.map((request) => ({
      id: request.id,
      status: request.status,
      reviewNote: request.reviewNote,
      createdAt: request.createdAt.toISOString(),
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      problem: {
        id: request.problem.id,
        displayId: request.problem.displayId,
        title: request.problem.title,
      },
      requester: {
        id: request.requestedBy.id,
        username: request.requestedBy.username,
        name: request.requestedBy.name,
      },
      author: request.problem.author,
      publishedProblemId: request.publishedProblemId,
    })),
  };
};

export const actions = {
  approve: withAction(async (event) => {
    const actor = requireAdmin(event);
    const id = readString(await event.request.formData(), "id");
    if (!id) return fail(400, { error: "ID is required." });
    const result = await problemDomain.approvePublicProblemPublication(actor, id);
    return { success: true, id: result.id };
  }),

  reject: withAction(async (event) => {
    const actor = requireAdmin(event);
    const formData = await event.request.formData();
    const id = readString(formData, "id");
    if (!id) return fail(400, { error: "ID is required." });
    const note = readString(formData, "reviewNote");
    const result = await problemDomain.rejectPublicProblemPublication(actor, id, note);
    return { success: true, id: result.id };
  }),
} satisfies Actions;
