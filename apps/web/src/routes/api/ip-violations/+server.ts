import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { prisma } from "@nojv/db";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const contestId = event.url.searchParams.get("contestId");
  const assessmentId = event.url.searchParams.get("assessmentId");

  if (!contestId && !assessmentId) {
    return json({ error: "contestId or assessmentId required" }, { status: 400 });
  }

  // Only admins/teachers can view violation logs
  if (actor.platformRole === "student") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const violations = await prisma.ipViolationLog.findMany({
    where: {
      ...(contestId ? { contestId } : {}),
      ...(assessmentId ? { assessmentId } : {})
    },
    include: {
      user: { select: { displayUsername: true, email: true, name: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return json({ violations });
});
