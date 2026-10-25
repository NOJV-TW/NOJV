import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { plagiarismDomain } from "@nojv/application";
import { writeApiHandler } from "#lib/server/shared/api-handler.js";

const { unflagPair } = plagiarismDomain;

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = event.params.id;
  if (!id) return Response.json({ message: "Missing flag id." }, { status: 400 });

  await unflagPair(actor, id);
  return new Response(null, { status: 204 });
});
