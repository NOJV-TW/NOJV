import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { NotFoundError, requireApiAuth, requirePlatformRole } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { contestDomain } from "@nojv/domain";

const { unfreezeContest } = contestDomain;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  requirePlatformRole(actor, "admin", "teacher");

  const { contestId } = event.params;
  if (!contestId) return json({ message: "Missing contest id." }, { status: 400 });

  const result = await unfreezeContest(contestId);
  if (!result) throw new NotFoundError("Contest not found.");

  return json({ ok: true });
});
