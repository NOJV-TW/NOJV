import {
  ConflictError,
  ForbiddenError,
  notificationDomain,
  userDomain,
} from "@nojv/application";
import { notificationPreferencesSchema } from "@nojv/core";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { fail, redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms/server";
import { zod4 } from "sveltekit-superforms/adapters";

import { getAuth } from "$lib/auth.server";
import { isReservedUsername } from "$lib/utils/school";
import { requireAuth } from "$lib/server/auth";
import { isLinkProvider, wouldOrphanAccount } from "$lib/server/account-connections";
import { handleSendVerificationAction } from "$lib/server/shared/school-verification";
import { withRateLimit, withRateLimitActions } from "$lib/server/shared/action-handlers";
import { forwardSetCookies } from "$lib/server/shared/auth-cookies";
import type { FormMessage } from "$lib/types/form-message";

import type { Actions, PageServerLoad } from "./$types";
import { loadTwoFactor, twoFactorActions } from "./two-factor-actions";

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

  const twoFactor = await loadTwoFactor(event);
  const accounts = sessionUser?.isSuperAdmin ? [] : await listAccounts(event);
  const accountEmails = sessionUser?.isSuperAdmin
    ? {}
    : await userDomain.listLinkedAccountEmails(locals.user.id);

  return {
    platformRole,
    notificationForm,
    email: locals.user.email,
    username,
    isSchoolVerified,
    canLinkProviders: !sessionUser?.isSuperAdmin,
    accounts: accounts.flatMap((account) =>
      isLinkProvider(account.providerId)
        ? [
            {
              provider: account.providerId,
              accountId: account.accountId,
              email: accountEmails[`${account.providerId}:${account.accountId}`] ?? null,
              createdAt: account.createdAt.toISOString(),
            },
          ]
        : [],
    ),
    ...twoFactor,
  };
};

export const actions = {
  ...withRateLimitActions(twoFactorActions),

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
      body: { provider, callbackURL: "/settings", errorCallbackURL: "/settings" },
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

  changeSecurityEmail: withRateLimit(async (event) => {
    requireAuth(event);
    if (event.locals.sessionUser?.isSuperAdmin) {
      return fail(403, { error: "securityEmailForbidden" });
    }
    const raw = formString(await event.request.formData(), "newEmail")
      .trim()
      .toLowerCase();
    if (!z.email().safeParse(raw).success) {
      return fail(400, { error: "securityEmailInvalid" });
    }
    if (raw === event.locals.user?.email.toLowerCase()) {
      return fail(400, { error: "securityEmailUnchanged" });
    }

    try {
      await getAuth().api.changeEmail({
        body: { newEmail: raw, callbackURL: "/settings" },
        headers: event.request.headers,
      });
    } catch (err) {
      if (isAPIError(err)) {
        if (err.status === "CONFLICT") return fail(409, { error: "securityEmailTaken" });
        if (err.status === "FORBIDDEN") return fail(403, { error: "securityEmailLocked" });
      }
      return fail(400, { error: "securityEmailFailed" });
    }
    return { securityEmailSentTo: event.locals.user?.email ?? "" };
  }),

  deleteAccount: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    if (event.locals.sessionUser?.isSuperAdmin) {
      return fail(403, { error: "deleteForbidden" });
    }
    const confirmation = formString(await event.request.formData(), "confirmation").trim();
    const expected = (
      event.locals.sessionUser?.username ?? event.locals.user?.email
    )?.toLowerCase();
    if (!expected || confirmation.toLowerCase() !== expected) {
      return fail(400, { error: "deleteConfirmation" });
    }

    try {
      if (!(await userDomain.deleteUser(false, actor.userId))) {
        return fail(404, { error: "deleteFailed" });
      }
    } catch (err) {
      if (err instanceof ConflictError) return fail(409, { error: "deleteBlocked" });
      if (err instanceof ForbiddenError) return fail(403, { error: "deleteForbidden" });
      throw err;
    }

    const cookie = (await getAuth().$context).createAuthCookie("session_token");
    event.cookies.delete(cookie.name, { path: cookie.attributes.path ?? "/" });
    redirect(303, "/");
  }),
} satisfies Actions;
