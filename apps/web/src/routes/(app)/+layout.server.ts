import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = (event) => {
  const session = event.locals.session;
  if (!session) {
    redirect(303, "/signin");
  }
  return { user: event.locals.user };
};
