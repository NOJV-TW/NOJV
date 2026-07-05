import { redirect } from "@sveltejs/kit";

import { EDITOR_LANGUAGE_COOKIE } from "$lib/components/features/problem/editors/editor-bindings";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = (event) => {
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
