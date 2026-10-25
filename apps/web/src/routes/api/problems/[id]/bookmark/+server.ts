import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { writeApiHandler } from "#lib/server/shared/api-handler.js";
import { problemDomain } from "@nojv/application";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { id } = event.params;
  if (!id) return Response.json({ message: "Missing problem ID." }, { status: 400 });

  const result = await problemDomain.toggleBookmark(actor.userId, id);
  return Response.json(result);
});
