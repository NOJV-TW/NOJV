import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { userDomain } from "@nojv/application";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  requireApiAuth(event);
  const user = event.locals.sessionUser;
  if (!user || user.platformRole === "admin") return json({ show: false });

  const show = await userDomain.claimOnboardingTour(user.id, user.platformRole);
  return json({ show });
});
