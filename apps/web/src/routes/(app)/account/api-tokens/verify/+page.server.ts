import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

import { getAuth } from "$lib/auth.server";
import { requireAuth } from "$lib/server/auth";
import {
  grantAdminElevation,
  isTwoFactorActivated,
  markAdminSessionMfa,
  markStepUpFresh,
  markTokenPageMfa,
  verifyStepUpCode,
} from "$lib/server/step-up";
import { stepUpAttemptRateLimiter } from "$lib/server/shared/rate-limiter";

const ADMIN_MODE_PURPOSE = "admin-mode";
const DEFAULT_DESTINATION = "/account/api-tokens";

function isAdminModePurpose(value: FormDataEntryValue | string | null): boolean {
  return value === ADMIN_MODE_PURPOSE;
}

export const load = async (event: RequestEvent) => {
  const actor = requireAuth(event);
  const adminModePurpose = isAdminModePurpose(event.url.searchParams.get("purpose"));
  const verifyPath = adminModePurpose
    ? "/account/api-tokens/verify?purpose=admin-mode"
    : "/account/api-tokens/verify";

  if (!(await isTwoFactorActivated(actor.userId))) {
    redirect(302, "/settings?setup2fa=1&returnTo=" + encodeURIComponent(verifyPath));
  }

  const hasTotp = event.locals.sessionUser?.twoFactorEnabled ?? false;
  const passkeys = await getAuth().api.listPasskeys({ headers: event.request.headers });
  const hasPasskey = passkeys.length > 0;

  if (!hasTotp && !hasPasskey) {
    redirect(302, "/settings?verify=totp&returnTo=" + encodeURIComponent(verifyPath));
  }

  return {
    purpose: adminModePurpose ? ADMIN_MODE_PURPOSE : null,
    destination: adminModePurpose ? "/admin" : DEFAULT_DESTINATION,
    hasTotp,
    hasPasskey,
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
    const adminModePurpose = isAdminModePurpose(formData.get("purpose"));

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

    const sessionId = event.locals.session?.id;
    if (sessionId) {
      await Promise.all([
        markStepUpFresh(sessionId),
        markTokenPageMfa(sessionId),
        ...(event.locals.sessionUser?.platformRole === "admin"
          ? [markAdminSessionMfa(sessionId, actor.userId)]
          : []),
      ]);
    }

    if (adminModePurpose) {
      if (!sessionId || !(await grantAdminElevation(sessionId, actor.userId))) {
        return fail(403, { error: "Admin mode is not available for this account." });
      }
      redirect(303, "/admin");
    }

    redirect(303, DEFAULT_DESTINATION);
  },
} satisfies Actions;
