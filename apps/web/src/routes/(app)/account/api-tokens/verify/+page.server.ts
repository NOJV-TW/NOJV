import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

import { requireAuth } from "$lib/server/auth";
import { markStepUpFresh, verifyStepUpCode } from "$lib/server/step-up";
import { stepUpAttemptRateLimiter } from "$lib/server/shared/rate-limiter";

const DEFAULT_RETURN_TO = "/account/api-tokens";

function sanitizeReturnTo(value: string | null): string {
  return typeof value === "string" && value.startsWith("/account/") ? value : DEFAULT_RETURN_TO;
}

export const load = (event: RequestEvent) => {
  requireAuth(event);

  if (!event.locals.sessionUser?.twoFactorEnabled) {
    redirect(302, "/account/two-factor?returnTo=" + encodeURIComponent(DEFAULT_RETURN_TO));
  }

  return {
    returnTo: sanitizeReturnTo(event.url.searchParams.get("returnTo")),
  };
};

export const actions = {
  default: async (event) => {
    const actor = requireAuth(event);

    try {
      await stepUpAttemptRateLimiter.consume(actor.userId);
    } catch {
      return fail(429, { error: "Too many attempts. Please try again later." });
    }

    const formData = await event.request.formData();
    const rawCode = formData.get("code");
    const code = (typeof rawCode === "string" ? rawCode : "").trim();
    const returnTo = sanitizeReturnTo(
      typeof formData.get("returnTo") === "string"
        ? (formData.get("returnTo") as string)
        : event.url.searchParams.get("returnTo"),
    );

    const result = await verifyStepUpCode(actor.userId, code, event.request.headers);
    if (!result.ok) {
      if (result.reason === "malformed") {
        return fail(400, { error: "Enter a 6-digit code or a backup code." });
      }
      if (result.reason === "replayed") {
        return fail(401, { error: "That code was already used. Wait for a new code." });
      }
      return fail(401, { error: "Invalid code. Try again." });
    }

    await markStepUpFresh(actor.userId);

    redirect(303, returnTo);
  },
} satisfies Actions;
