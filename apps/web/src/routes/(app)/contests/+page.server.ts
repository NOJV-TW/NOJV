import { fail, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { getActorContext, requireAuth } from "$lib/server/auth";
import { findContestByInviteCode, listPublicContests } from "$lib/server/contest/queries";

export const load: PageServerLoad = async (event) => {
  const actor = getActorContext(event);
  const contests = await listPublicContests();
  return { contests, loggedIn: actor != null };
};

export const actions = {
  joinByCode: async (event) => {
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
