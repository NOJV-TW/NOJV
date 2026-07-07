import { redirect } from "@sveltejs/kit";

import { EDITOR_LANGUAGE_COOKIE } from "$lib/components/features/problem/editors/editor-bindings";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = (event) => {
  // Touch `url` so this layout load re-runs on every navigation. Otherwise
  // canActAsAdmin/actingAsAdmin freeze at their first computed value, and a role
  // change (e.g. being promoted to admin mid-session) only surfaces after a full
  // reload or an incidental invalidateAll — the "admin toggle only appears after
  // adding a passkey" bug.
  void event.url.pathname;

  const session = event.locals.session;
  if (!session) {
    redirect(302, "/signin");
  }

  return {
    user: event.locals.sessionUser,
    canActAsAdmin: event.locals.sessionUser?.platformRole === "admin",
    actingAsAdmin: event.locals.adminModeActive,
    editorLanguage: event.cookies.get(EDITOR_LANGUAGE_COOKIE),
  };
};
