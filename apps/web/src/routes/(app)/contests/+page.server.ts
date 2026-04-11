import { fail, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { getActorContext, requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { contestDomain } from "@nojv/domain";

const { findContestByInviteCode, listContestsForUser } = contestDomain;

export const load: PageServerLoad = async (event) => {
  const actor = getActorContext(event);
  const { managed, participable } = await listContestsForUser(actor?.userId ?? null);
  return { managed, participable, loggedIn: actor != null };
};

export const actions = {
  joinByCode: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    requireAuth(event);

    const formData = await event.request.formData();
    const code = (formData.get("code") as string | null)?.trim();

    if (!code) {
      return fail(400, { codeError: "Please enter a contest code." });
    }

    const contest = await findContestByInviteCode(code);

    if (contest?.visibility !== "published" || contest.courseId !== null) {
      return fail(404, { codeError: "Invalid contest code." });
    }

    redirect(303, `/contests/${contest.slug}`);
  }
} satisfies Actions;
