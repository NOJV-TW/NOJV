import { userDomain } from "@nojv/domain";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import { getAuth } from "$lib/auth.server";
import { requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import type { FormMessage } from "$lib/types/form-message";

import type { Actions, PageServerLoad } from "./$types";
import { changePasswordSchema } from "./schemas";

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    redirect(302, "/signin");
  }
  const form = await superValidate(zod4(changePasswordSchema));
  return {
    form,
    forced: event.locals.sessionUser?.mustChangePassword ?? false,
  };
};

export const actions = {
  default: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate(event, zod4(changePasswordSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    try {
      await getAuth().api.changePassword({
        body: {
          currentPassword: form.data.currentPassword,
          newPassword: form.data.newPassword,
          revokeOtherSessions: true,
        },
        headers: event.request.headers,
      });
    } catch {
      return message<FormMessage>(
        form,
        { kind: "error", text: "account_changePassword_wrongCurrent" },
        { status: 400 },
      );
    }

    await userDomain.markPasswordChanged(actor.userId);
    redirect(303, "/");
  }),
} satisfies Actions;
