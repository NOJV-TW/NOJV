import { redirect } from "@sveltejs/kit";

import { EDITOR_LANGUAGE_COOKIE } from "$lib/components/features/problem/editors/editor-bindings";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = (event) => {
  // Touch `url` so this layout load re-runs on every navigation. Otherwise
  // Re-run after navigation so role and admin-mode changes reach the header.
  void event.url.pathname;

  const session = event.locals.session;
  if (!session) {
    redirect(302, "/signin");
  }

  return {
    user: event.locals.sessionUser,
    actingAsAdmin: event.locals.adminModeActive,
    editorLanguage: event.cookies.get(EDITOR_LANGUAGE_COOKIE),
  };
};
