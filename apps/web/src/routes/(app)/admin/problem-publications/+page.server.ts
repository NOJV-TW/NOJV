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

function parseView(value: string | null): "pending" | "closed" {
  return value === "closed" ? "closed" : "pending";
}

export const load: PageServerLoad = async (event) => {
  const actor = requireAdmin(event);
  const status = parseView(event.url.searchParams.get("status"));
  const result =
    status === "pending"
      ? await problemDomain.listPublicProblemPublicationRequests(actor, {
          status: "pending",
          limit: 100,
        })
      : await Promise.all(
          (["approved", "rejected"] as const).map((requestStatus) =>
            problemDomain.listPublicProblemPublicationRequests(actor, {
              status: requestStatus,
              limit: 100,
            }),
          ),
        ).then((results) => ({
          items: results
            .flatMap((page) => page.items)
            .sort(
              (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime() ||
                right.id.localeCompare(left.id),
            )
            .slice(0, 100),
          nextCursor: null,
        }));

  return {
    status,
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
