import { redirect } from "@sveltejs/kit";

import { handleSendVerificationAction } from "$lib/server/shared/school-verification";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  const user = locals.user;

  if (!user) {
    redirect(302, "/");
  }

  if (locals.sessionUser?.username) {
    redirect(302, "/");
  }

  return {
    email: user.email,
    name: user.name || user.email
  };
};

export const actions = {
  sendVerification: handleSendVerificationAction
} satisfies Actions;
