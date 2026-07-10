import { notificationDomain } from "@nojv/application";
import { notificationPreferencesSchema } from "@nojv/core";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import { requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import type { FormMessage } from "$lib/types/form-message";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/");
  }

  const platformRole = locals.sessionUser?.platformRole ?? "student";
  const prefs = await notificationDomain.getNotificationPreferences(locals.user.id);
  const notificationForm = await superValidate(prefs, zod4(notificationPreferencesSchema));

  return { platformRole, notificationForm };
};

export const actions = {
  updateNotificationPreferences: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate(event, zod4(notificationPreferencesSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    await notificationDomain.updateNotificationPreferences(actor.userId, form.data);

    return message<FormMessage>(form, { kind: "success", text: "OK" });
  }),
} satisfies Actions;
