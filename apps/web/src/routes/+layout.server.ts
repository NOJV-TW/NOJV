import { parseSessionUser } from "$lib/session";

import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals }) => {
  return {
    session: locals.session,
    user: parseSessionUser(locals.user)
  };
};
