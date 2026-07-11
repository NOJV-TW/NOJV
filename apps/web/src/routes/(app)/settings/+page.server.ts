import { notificationDomain } from "@nojv/application";
import { notificationPreferencesSchema } from "@nojv/core";
import { getMailer, renderEmail } from "@nojv/mailer";
import { fail, redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import { getAuth } from "$lib/auth.server";
import { isReservedUsername } from "$lib/utils/school";
import { requireAuth } from "$lib/server/auth";
import {
  isLinkProvider,
  LINKABLE_PROVIDERS,
  wouldOrphanAccount,
} from "$lib/server/account-connections";
import { createLogger } from "$lib/server/logger";
import { handleSendVerificationAction } from "$lib/server/shared/school-verification";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import type { FormMessage } from "$lib/types/form-message";

import type { Actions, PageServerLoad } from "./$types";
import { loadTwoFactor, twoFactorActions } from "./two-factor-actions";

const connectionsLogger = createLogger("account-connections");

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function changeEmailHtml(provider: string, action: "linked" | "unlinked"): string {
  const verb = action === "linked" ? "新增了" : "移除了";
  const verbEn = action === "linked" ? "added to" : "removed from";
  return renderEmail({
    heading: "帳號登入方式變更 · Sign-in method changed",
    intro: `<p>你的 NOJV 帳號剛${verb}一個登入方式：<strong>${provider}</strong>。</p><p>A sign-in method was just ${verbEn} your NOJV account: <strong>${provider}</strong>.</p>`,
    outro:
      "若這不是你本人操作，請立即聯絡管理員並檢查帳號安全。<br>If this wasn't you, contact an administrator and secure your account.",
  });
}

async function listProviderIds(event: RequestEvent): Promise<string[]> {
  const accounts = await getAuth().api.listUserAccounts({ headers: event.request.headers });
  return accounts.map((account) => account.providerId);
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

  const linkedProviderIds = await listProviderIds(event);
  const twoFactor = await loadTwoFactor(event);

  return {
    platformRole,
    notificationForm,
    email: locals.user.email,
    isSchoolVerified,
    providers: LINKABLE_PROVIDERS.map((provider) => ({
      provider,
      linked: linkedProviderIds.includes(provider),
    })),
    ...twoFactor,
  };
};

export const actions = {
  ...twoFactorActions,

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

  link: async (event) => {
    requireAuth(event);
    const provider = formString(await event.request.formData(), "provider");
    if (!isLinkProvider(provider)) {
      return fail(400, { error: "unknownProvider" });
    }
    const res = await getAuth().api.linkSocialAccount({
      body: { provider, callbackURL: "/settings" },
      headers: event.request.headers,
    });
    if (res.url) {
      redirect(303, res.url);
    }
    return fail(400, { error: "linkFailed" });
  },

  unlink: async (event) => {
    const actor = requireAuth(event);
    const provider = formString(await event.request.formData(), "provider");
    if (!isLinkProvider(provider)) {
      return fail(400, { error: "unknownProvider" });
    }
    if (wouldOrphanAccount(await listProviderIds(event), provider)) {
      return fail(400, { error: "orphan" });
    }
    try {
      await getAuth().api.unlinkAccount({
        body: { providerId: provider },
        headers: event.request.headers,
      });
    } catch {
      return fail(400, { error: "unlinkFailed" });
    }
    try {
      await getMailer().sendEmail({
        to: actor.email,
        subject: "NOJV 帳號登入方式變更",
        html: changeEmailHtml(provider, "unlinked"),
      });
    } catch (err) {
      connectionsLogger.error("unlink notification email failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { unlinked: provider };
  },
} satisfies Actions;
