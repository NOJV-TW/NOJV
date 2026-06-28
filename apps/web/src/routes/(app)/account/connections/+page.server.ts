import { fail, redirect } from "@sveltejs/kit";
import type { Actions, RequestEvent } from "@sveltejs/kit";

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

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
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
  const passkeys = await getAuth().api.listPasskeys({ headers: event.request.headers });
  return {
    providers: LINKABLE_PROVIDERS.map((provider) => ({
      provider,
      linked: linkedProviderIds.includes(provider),
    })),
    passkeys: passkeys.map((p) => ({
      id: p.id,
      name: p.name ?? "Passkey",
      createdAt: p.createdAt,
    })),
  };
};

export const actions = {
  link: async (event) => {
    requireAuth(event);
    const provider = formString(await event.request.formData(), "provider");
    if (!isLinkProvider(provider)) {
      return fail(400, { error: "Unknown provider." });
    }
    const res = await getAuth().api.linkSocialAccount({
      body: { provider, callbackURL: "/account/connections" },
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
      logger.error("unlink notification email failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { unlinked: provider };
  },

  deletePasskey: async (event) => {
    const actor = requireAuth(event);
    const id = formString(await event.request.formData(), "id");
    if (!id) {
      return fail(400, { error: "Missing passkey id." });
    }
    try {
      await getAuth().api.deletePasskey({ body: { id }, headers: event.request.headers });
    } catch {
      return fail(400, { error: "Could not remove this passkey." });
    }
    try {
      await getMailer().sendEmail({
        to: actor.email,
        subject: "NOJV 帳號登入方式變更",
        html: changeEmailHtml("passkey", "unlinked"),
      });
    } catch (err) {
      logger.error("passkey delete notification email failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { deletedPasskey: true };
  },
} satisfies Actions;
