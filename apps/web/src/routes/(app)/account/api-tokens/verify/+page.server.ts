import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

import { requireAuth } from "$lib/server/auth";
import {
  isBackupCodeFormat,
  markStepUpFresh,
  markTotpSeen,
  validateStepUpCode,
  verifyBackupCodeStepUp,
  verifyTotpStepUp,
  wasTotpSeen,
} from "$lib/server/step-up";
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

    if (validateStepUpCode(code)) {
      if (await wasTotpSeen(actor.userId, code)) {
        return fail(401, { error: "That code was already used. Wait for a new code." });
      }
      if (!(await verifyTotpStepUp(code, event.request.headers))) {
        return fail(401, { error: "Invalid code. Try again." });
      }
      await markTotpSeen(actor.userId, code);
    } else if (isBackupCodeFormat(code)) {
      if (!(await verifyBackupCodeStepUp(code, event.request.headers))) {
        return fail(401, { error: "Invalid code. Try again." });
      }
    } else {
      return fail(400, { error: "Enter a 6-digit code or a backup code." });
    }

    await markStepUpFresh(actor.userId);

    redirect(303, returnTo);
  },
} satisfies Actions;
