import { redirect } from "@sveltejs/kit";

import { handleSendVerificationAction } from "$lib/server/shared/school-verification";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/");
  }

  if (locals.sessionUser?.username) {
    redirect(302, "/");
  }

  return {};
};

export const actions = {
  sendVerification: handleSendVerificationAction
} satisfies Actions;
