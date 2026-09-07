import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";
import { adminMfaKind, getSecurityFactorState } from "@nojv/application";

import { requireAuth } from "$lib/server/auth";
import {
  adminAccessPrincipal,
  grantAdminMode,
  markVerifiedSession,
  securityGenerationProof,
  verifyStepUpCode,
} from "$lib/server/step-up";
import { withRateLimit } from "$lib/server/shared/action-handlers";
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

  const state = await getSecurityFactorState(actor.userId);
  if (!state?.hasSecurityFactor) {
    redirect(302, "/settings?setupSecurity=1&returnTo=" + encodeURIComponent(verifyPath));
  }

  const { hasTotp, hasPasskey } = state;

  if (!hasTotp && !hasPasskey) {
    redirect(302, "/settings?setupSecurity=1&returnTo=" + encodeURIComponent(verifyPath));
  }

  return {
    purpose: adminModePurpose ? ADMIN_MODE_PURPOSE : null,
    destination: adminModePurpose ? "/admin" : DEFAULT_DESTINATION,
    hasTotp,
    hasPasskey,
  };
};

export const actions = {
  default: withRateLimit(async (event) => {
    const actor = requireAuth(event);

    const rateLimit = await stepUpAttemptRateLimiter.consume(actor.userId);
    if (rateLimit === "limited") {
      return fail(429, { error: "Too many attempts. Please try again later." });
    }
    if (rateLimit === "unavailable") {
      return fail(503, { error: "Rate limiter unavailable. Please try again later." });
    }

    const formData = await event.request.formData();
    const rawCode = formData.get("code");
    const code = (typeof rawCode === "string" ? rawCode : "").trim();
    const adminModePurpose = isAdminModePurpose(formData.get("purpose"));

    const sessionUser = event.locals.sessionUser;
    if (!sessionUser) {
      return fail(403, { error: "Session authentication is required." });
    }
    const proof = securityGenerationProof(sessionUser);
    const state = await getSecurityFactorState(sessionUser.id);
    const result = await verifyStepUpCode(
      proof,
      code,
      event.request.headers,
      state?.hasTotp ?? false,
    );
    if (!result.ok) {
      if (result.reason === "malformed") {
        return fail(400, { error: "Enter the 6-digit code from your authenticator." });
      }
      if (result.reason === "replayed") {
        return fail(401, { error: "That code was already used. Wait for a new code." });
      }
      if (result.reason === "factor_unavailable") {
        return fail(403, {
          error: "Set up and verify an authenticator before using its code.",
        });
      }
      return fail(401, { error: "Invalid code. Try again." });
    }

    const sessionId = event.locals.session?.id;
    if (
      !sessionId ||
      !(await markVerifiedSession(sessionId, proof, adminMfaKind(sessionUser)))
    ) {
      return fail(403, { error: "The account security state changed. Verify again." });
    }

    if (adminModePurpose) {
      if (!(await grantAdminMode(sessionId, adminAccessPrincipal(sessionUser)))) {
        return fail(403, { error: "Admin mode is not available for this account." });
      }
      redirect(303, "/admin");
    }

    redirect(303, DEFAULT_DESTINATION);
  }),
} satisfies Actions;
