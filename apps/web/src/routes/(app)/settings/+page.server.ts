import { notificationDomain } from "@nojv/application";
import { notificationPreferencesSchema } from "@nojv/core";
import { fail, redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms/server";
import { zod4 } from "sveltekit-superforms/adapters";

import { getAuth } from "$lib/auth.server";
import { isReservedUsername } from "$lib/utils/school";
import { requireAuth } from "$lib/server/auth";
import {
  isLinkProvider,
  LINKABLE_PROVIDERS,
  wouldOrphanAccount,
} from "$lib/server/account-connections";
import { handleSendVerificationAction } from "$lib/server/shared/school-verification";
import { withRateLimit, withRateLimitActions } from "$lib/server/shared/action-handlers";
import { forwardSetCookies } from "$lib/server/shared/auth-cookies";
import type { FormMessage } from "$lib/types/form-message";

import type { Actions, PageServerLoad } from "./$types";
import { changeEmailSchema } from "./email-schema";
import { loadTwoFactor, twoFactorActions } from "./two-factor-actions";

const emailVerificationErrors = {
  INVALID_TOKEN: "invalidToken",
  TOKEN_EXPIRED: "tokenExpired",
} as const;

type EmailVerificationError =
  (typeof emailVerificationErrors)[keyof typeof emailVerificationErrors];

function getEmailVerificationError(event: RequestEvent): EmailVerificationError | null {
  const error = event.url.searchParams.get("error");
  return error && error in emailVerificationErrors
    ? emailVerificationErrors[error as keyof typeof emailVerificationErrors]
    : null;
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function listAccounts(event: RequestEvent) {
  return getAuth().api.listUserAccounts({ headers: event.request.headers });
}

export const load: PageServerLoad = async (event) => {
  const { locals } = event;
  if (!locals.user) {
    redirect(302, "/");
  }

  const sessionUser = locals.sessionUser;
  const username = sessionUser?.username ?? null;
  const platformRole = sessionUser?.platformRole ?? "student";
  const isSchoolVerified = username !== null && isReservedUsername(username);

  const prefs = await notificationDomain.getNotificationPreferences(locals.user.id);
  const notificationForm = await superValidate(prefs, zod4(notificationPreferencesSchema));
  const emailForm = await superValidate({ newEmail: "" }, zod4(changeEmailSchema), {
    errors: false,
  });

  const twoFactor = await loadTwoFactor(event);
  const accounts = sessionUser?.isSuperAdmin ? [] : await listAccounts(event);

  return {
    platformRole,
    notificationForm,
    emailForm,
    email: locals.user.email,
    emailVerified: locals.user.emailVerified,
    emailVerificationError: getEmailVerificationError(event),
    isSchoolVerified,
    providers: sessionUser?.isSuperAdmin
      ? []
      : LINKABLE_PROVIDERS.map((provider) => ({
          provider,
          accounts: accounts
            .filter((account) => account.providerId === provider)
            .map((account) => ({
              accountId: account.accountId,
              createdAt: account.createdAt.toISOString(),
            })),
        })),
    ...twoFactor,
  };
};

export const actions = {
  ...withRateLimitActions(twoFactorActions),

  changeEmail: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate(event, zod4(changeEmailSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    try {
      await getAuth().api.changeEmail({
        body: {
          newEmail: form.data.newEmail,
          callbackURL: "/settings",
        },
        headers: event.request.headers,
      });
    } catch {
      return message<FormMessage>(
        form,
        { kind: "error", text: "account_emailChange_failed" },
        { status: 400 },
      );
    }

    return message<FormMessage>(form, {
      kind: "success",
      text: actor.emailVerified
        ? "account_emailChange_verificationSent"
        : "account_emailChange_verificationSentUnverified",
    });
  }),

  sendVerification: handleSendVerificationAction,

  updateNotificationPreferences: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate(event, zod4(notificationPreferencesSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    await notificationDomain.updateNotificationPreferences(actor.userId, form.data);

    return message<FormMessage>(form, { kind: "success", text: "OK" });
  }),

  link: withRateLimit(async (event) => {
    requireAuth(event);
    if (event.locals.sessionUser?.isSuperAdmin) {
      return fail(403, { error: "linkFailed" });
    }
    const provider = formString(await event.request.formData(), "provider");
    if (!isLinkProvider(provider)) {
      return fail(400, { error: "unknownProvider" });
    }
    const res = await getAuth().api.linkSocialAccount({
      body: { provider, callbackURL: "/settings" },
      headers: event.request.headers,
      returnHeaders: true,
    });
    if (res.response.url) {
      forwardSetCookies(event, res.headers);
      redirect(303, res.response.url);
    }
    return fail(400, { error: "linkFailed" });
  }),

  unlink: withRateLimit(async (event) => {
    requireAuth(event);
    if (event.locals.sessionUser?.isSuperAdmin) {
      return fail(403, { error: "unlinkFailed" });
    }
    const formData = await event.request.formData();
    const provider = formString(formData, "provider");
    const accountId = formString(formData, "accountId");
    if (!isLinkProvider(provider) || !accountId) {
      return fail(400, { error: "unknownProvider" });
    }
    const providerIds = (await listAccounts(event)).map((account) => account.providerId);
    if (wouldOrphanAccount(providerIds, provider)) {
      return fail(400, { error: "orphan" });
    }
    try {
      await getAuth().api.unlinkAccount({
        body: { providerId: provider, accountId },
        headers: event.request.headers,
      });
    } catch {
      return fail(400, { error: "unlinkFailed" });
    }
    return { unlinked: provider };
  }),
} satisfies Actions;
