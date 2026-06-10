import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import { submissionPendingTimeoutMinutesSchema } from "@nojv/core";
import { submissionDomain } from "@nojv/domain";

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const problemIdRaw = url.searchParams.get("problemId")?.trim();
  const problemId = problemIdRaw && problemIdRaw.length > 0 ? problemIdRaw : undefined;

  const [{ items, nextCursor }, pendingTimeoutMinutes] = await Promise.all([
    submissionDomain.listRejudgeLogsPaged({
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
      ...(problemId ? { problemId } : {}),
    }),
    submissionDomain.getSubmissionPendingTimeoutMinutes(),
  ]);

  return { logs: items, nextCursor, problemId: problemId ?? "", pendingTimeoutMinutes };
};

export const actions = {
  updatePendingTimeout: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") {
      return fail(403, { error: "Admin access required." });
    }
    const raw = readString(await event.request.formData(), "pendingTimeoutMinutes");
    const parsed = submissionPendingTimeoutMinutesSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(400, { error: "Invalid input." });
    }

    await submissionDomain.setSubmissionPendingTimeoutMinutes(parsed.data);
    return { success: true };
  }),
} satisfies Actions;
