import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { NotFoundError, requireApiAuth, requirePlatformRole } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { contestDomain } from "@nojv/domain";

const { unfreezeContest } = contestDomain;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  requirePlatformRole(actor, "admin", "teacher");

  const { slug } = event.params;
  if (!slug) return json({ message: "Missing contest slug." }, { status: 400 });

  const result = await unfreezeContest(slug);
  if (!result) throw new NotFoundError("Contest not found.");

  return json({ ok: true });
});
