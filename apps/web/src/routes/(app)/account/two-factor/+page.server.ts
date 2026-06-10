import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = (event) => {
  if (!event.locals.user) {
    redirect(302, "/signin");
  }
  return {
    twoFactorEnabled: event.locals.sessionUser?.twoFactorEnabled ?? false,
    platformRole: event.locals.sessionUser?.platformRole ?? "student",
  };
};
