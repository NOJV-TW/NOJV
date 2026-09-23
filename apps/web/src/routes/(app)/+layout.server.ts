import { createHmac } from "node:crypto";
import { redirect } from "@sveltejs/kit";

import { EDITOR_LANGUAGE_COOKIE } from "$lib/components/features/problem/editors/editor-bindings";
import { getWebEnv } from "$lib/server/env";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = (event) => {
  // Re-run after navigation so role and admin-mode changes reach the header.
  // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- SvelteKit tracks this property read.
  void event.url.pathname;

  const session = event.locals.session;
  if (!session) {
    redirect(302, "/signin");
  }

  const secret = getWebEnv().BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for draft encryption.");

  return {
    user: event.locals.sessionUser,
    draftCipherKey: createHmac("sha256", secret)
      .update(`code-draft:${session.userId}`)
      .digest("base64"),
    adminAccessActive: event.locals.adminAccessActive,
    editorLanguage: event.cookies.get(EDITOR_LANGUAGE_COOKIE),
  };
};
