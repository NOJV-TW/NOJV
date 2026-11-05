import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals, depends }) => {
  depends("nojv:clock");
  return {
    session: locals.session,
    user: locals.sessionUser,
    serverNow: Date.now(),
  };
};
