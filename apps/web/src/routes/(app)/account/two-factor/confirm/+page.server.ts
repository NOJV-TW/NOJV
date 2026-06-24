import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

import { requireAuth } from "$lib/server/auth";
import { confirmEnroll, peekEnrollConfirm } from "$lib/server/two-factor-enroll";

export const load = async (event: RequestEvent) => {
  const actor = requireAuth(event);
  const token = event.url.searchParams.get("token");
  if (!token) return { status: "error" as const };
  const userId = await peekEnrollConfirm(token);
  if (userId !== actor.userId) return { status: "error" as const };
  return { status: "confirm" as const, token };
};

export const actions = {
  default: async (event: RequestEvent) => {
    const actor = requireAuth(event);
    const token = (await event.request.formData()).get("token");
    if (typeof token !== "string" || !token) {
      return fail(400, { status: "error" as const });
    }
    if ((await peekEnrollConfirm(token)) !== actor.userId) {
      return fail(400, { status: "error" as const });
    }
    await confirmEnroll(token);
    redirect(303, "/account/two-factor");
  },
} satisfies Actions;
