import { prisma } from "@nojv/db";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { NotFoundError, requireApiAuth, requirePlatformRole } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  requirePlatformRole(actor, "admin", "teacher");

  const { slug } = event.params;
  if (!slug) return json({ message: "Missing contest slug." }, { status: 400 });

  const contest = await prisma.contest.findUnique({ where: { slug } });
  if (!contest) throw new NotFoundError("Contest not found.");

  await prisma.contest.update({
    data: { frozenAt: null },
    where: { id: contest.id }
  });

  return json({ ok: true });
});
