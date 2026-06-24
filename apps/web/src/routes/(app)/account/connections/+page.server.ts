import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";
import type { Session } from "better-auth";

import { getAuth } from "$lib/auth.server";
import { requireAuth } from "$lib/server/auth";
import {
  isLinkProvider,
  LINKABLE_PROVIDERS,
  wouldOrphanAccount,
} from "$lib/server/account-connections";
import { createLogger } from "$lib/server/logger";
import { getMailer } from "$lib/server/mailer";

const logger = createLogger("connections");

const FRESH_WINDOW_MS = 5 * 60 * 1000;

function freshEnough(session: Session | null): boolean {
  if (!session) return false;
  return Date.now() - new Date(session.createdAt).getTime() < FRESH_WINDOW_MS;
}

function changeEmailHtml(provider: string, action: "linked" | "unlinked"): string {
  const verb = action === "linked" ? "新增了" : "移除了";
  return `<p>你的 NOJV 帳號剛${verb}一個登入方式:<strong>${provider}</strong>。</p><p>若這不是你本人操作,請立即聯絡管理員並檢查帳號安全。</p>`;
}

async function listProviderIds(event: RequestEvent): Promise<string[]> {
  const accounts = await getAuth().api.listUserAccounts({ headers: event.request.headers });
  return accounts.map((account) => account.providerId);
}

export const load = async (event: RequestEvent) => {
  requireAuth(event);
  const linkedProviderIds = await listProviderIds(event);
  return {
    providers: LINKABLE_PROVIDERS.map((provider) => ({
      provider,
      linked: linkedProviderIds.includes(provider),
    })),
  };
};

export const actions = {
  link: async (event) => {
    requireAuth(event);
    if (!freshEnough(event.locals.session)) {
      return fail(403, { needsReauth: true });
    }
    const provider = String((await event.request.formData()).get("provider") ?? "");
    if (!isLinkProvider(provider)) {
      return fail(400, { error: "Unknown provider." });
    }
    const res = await getAuth().api.linkSocialAccount({
      body: { provider, callbackURL: "/account/connections" },
      headers: event.request.headers,
    });
    if (res?.url) {
      redirect(303, res.url);
    }
    return fail(400, { error: "Could not start linking." });
  },

  unlink: async (event) => {
    const actor = requireAuth(event);
    if (!freshEnough(event.locals.session)) {
      return fail(403, { needsReauth: true });
    }
    const provider = String((await event.request.formData()).get("provider") ?? "");
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
      logger.error("unlink notification email failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { unlinked: provider };
  },
} satisfies Actions;
