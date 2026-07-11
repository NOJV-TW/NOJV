import { notificationDomain } from "@nojv/application";
import { notificationPreferencesSchema } from "@nojv/core";
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
import { handleSendVerificationAction } from "$lib/server/shared/school-verification";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import type { FormMessage } from "$lib/types/form-message";

import type { Actions, PageServerLoad } from "./$types";
import { loadTwoFactor, twoFactorActions } from "./two-factor-actions";

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
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
    requireAuth(event);
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
    return { unlinked: provider };
  },
} satisfies Actions;
