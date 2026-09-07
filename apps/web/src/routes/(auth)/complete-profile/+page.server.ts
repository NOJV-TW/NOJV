import { fail, redirect } from "@sveltejs/kit";

import { userDomain } from "@nojv/application";
import { withAction } from "$lib/server/shared/action-handlers";
import { classifyRequestError } from "$lib/server/shared/handle-action-error";

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
  setUsername: withAction(async (event) => {
    if (!event.locals.user) return fail(401, { error: "Unauthorized" });
    const value = (await event.request.formData()).get("username");
    if (typeof value !== "string") return fail(400, { error: "Invalid username" });
    try {
      await userDomain.renameUsername(event.locals.user.id, value);
      return { success: true };
    } catch (error) {
      const classified = classifyRequestError(error, event);
      return fail(classified.status, { error: classified.message });
    }
  }),
  sendVerification: handleSendVerificationAction,
} satisfies Actions;
