import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { plagiarismDomain } from "@nojv/domain";
import { writeApiHandler } from "$lib/server/shared/api-handler";

const { unflagPair } = plagiarismDomain;

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = event.params.id;
  if (!id) return json({ message: "Missing flag id." }, { status: 400 });

  await unflagPair(actor, id);
  return json({ ok: true });
});
