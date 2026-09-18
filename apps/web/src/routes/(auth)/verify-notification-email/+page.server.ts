import { fail } from "@sveltejs/kit";
import { notificationDomain } from "@nojv/application";

import { m } from "$lib/paraglide/messages.js";

import type { Actions, PageServerLoad } from "./$types";
import { withAction } from "$lib/server/shared/action-handlers";

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get("token");
  if (!token) return { status: "error" as const, detail: m.auth_missingVerifyToken() };

  const result = await notificationDomain.peekNotificationEmail(token);
  if (result.status === "error") return { status: "error" as const, detail: result.detail };
  return { status: "confirm" as const, email: result.email, token };
};

export const actions: Actions = {
  default: withAction(async ({ request }) => {
    const token = (await request.formData()).get("token");
    if (typeof token !== "string" || !token) {
      return fail(400, { status: "error" as const, detail: m.auth_missingVerifyToken() });
    }
    return notificationDomain.verifyNotificationEmail(token);
  }),
};
