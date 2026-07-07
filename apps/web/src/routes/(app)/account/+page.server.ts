import { userDomain } from "@nojv/application";
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
import { getMailer } from "$lib/server/mailer";
import { renderEmail } from "$lib/server/mailer/template";
import { handleSendVerificationAction } from "$lib/server/shared/school-verification";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import type { FormMessage } from "$lib/types/form-message";

import type { Actions, PageServerLoad } from "./$types";
import { nameSchema, usernameSchema } from "./schemas";

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

const ERROR_STATUS: Record<string, number> = {
  VERIFIED_LOCKED: 409,
  PLACEHOLDER_LOCKED: 403,
  TAKEN: 409,
  RESERVED_FORMAT: 409,
  INVALID_FORMAT: 400,
  INVALID_NAME: 400,
};

function classifyDomainError(err: unknown): { code: string; status: number } {
  if (err instanceof Error) {
    const mapped = ERROR_STATUS[err.message];
    if (mapped !== undefined) {
      return { code: err.message, status: mapped };
    }
  }
  return { code: "UNEXPECTED", status: 500 };
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

  const canEditUsername = !isSchoolVerified && sessionUser?.status !== "pending_first_login";

  const nameForm = await superValidate({ name: locals.user.name }, zod4(nameSchema));
  const usernameForm = await superValidate({ username: username ?? "" }, zod4(usernameSchema));

  const linkedProviderIds = await listProviderIds(event);

  return {
    email: locals.user.email,
    username: username ?? "\u2014",
    isSchoolVerified,
    canEditUsername,
    name: locals.user.name,
    image: (locals.user as { image?: string | null }).image ?? null,
    platformRole,
    nameForm,
    usernameForm,
    providers: LINKABLE_PROVIDERS.map((provider) => ({
      provider,
      linked: linkedProviderIds.includes(provider),
    })),
  };
};

export const actions = {
  sendVerification: handleSendVerificationAction,

  updateName: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate(event, zod4(nameSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    try {
      await userDomain.renameName(actor.userId, form.data.name);
    } catch (err) {
      const { code, status } = classifyDomainError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: code },
        { status: status as 400 | 403 | 409 | 500 },
      );
    }

    return message<FormMessage>(form, { kind: "success", text: "OK" });
  }),

  updateUsername: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate(event, zod4(usernameSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    let merged: boolean;
    try {
      const result = await userDomain.renameUsername(actor.userId, form.data.username);
      merged = result.merged;
    } catch (err) {
      const { code, status } = classifyDomainError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: code },
        { status: status as 400 | 403 | 409 | 500 },
      );
    }

    return message<FormMessage>(form, {
      kind: "success",
      text: merged ? "MERGED" : "OK",
    });
  }),

  link: async (event) => {
    requireAuth(event);
    const provider = formString(await event.request.formData(), "provider");
    if (!isLinkProvider(provider)) {
      return fail(400, { error: "Unknown provider." });
    }
    const res = await getAuth().api.linkSocialAccount({
      body: { provider, callbackURL: "/account" },
      headers: event.request.headers,
    });
    if (res.url) {
      redirect(303, res.url);
    }
    return fail(400, { error: "Could not start linking." });
  },

  unlink: async (event) => {
    const actor = requireAuth(event);
    const provider = formString(await event.request.formData(), "provider");
    if (!isLinkProvider(provider)) {
      return fail(400, { error: "Unknown provider." });
    }
    if (wouldOrphanAccount(await listProviderIds(event), provider)) {
      return fail(400, { error: "You can't remove your only sign-in method." });
    }
    try {
      await getAuth().api.unlinkAccount({
        body: { providerId: provider },
        headers: event.request.headers,
      });
    } catch {
      return fail(400, { error: "Could not unlink this provider." });
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
