import { error } from "@sveltejs/kit";
import { prisma } from "@nojv/db";

import type { PageServerLoad } from "./$types";
import { getContestDetail } from "$lib/server/contest/queries";
import { checkIpLock, getClientIp } from "$lib/server/ip-utils";

export const load: PageServerLoad = async ({ params, locals, request }) => {
  const contest = await getContestDetail(params.slug);

  if (!contest) {
    error(404, "Contest not found");
  }

  const user = locals.user;

  if (user && (contest.ipWhitelistEnabled || contest.ipBindingEnabled)) {
    const now = new Date();
    const isActive = new Date(contest.startsAt) <= now && now <= new Date(contest.endsAt);

    if (isActive) {
      const clientIp = getClientIp(request);

      const participation = await prisma.contestParticipation.findUnique({
        select: { id: true, boundIp: true },
        where: {
          contestId_userId: {
            contestId: contest.id,
            userId: user.id
          }
        }
      });

      const ipResult = await checkIpLock(
        contest,
        clientIp,
        participation,
        { userId: user.id, contestId: contest.id },
        "contestParticipation"
      );

      if (!ipResult.allowed && contest.ipViolationMode === "block") {
        error(
          403,
          ipResult.violationType === "whitelist"
            ? "Your IP address is not in the allowed range for this contest."
            : "Your IP address does not match the one bound to your session."
        );
      }
    }
  }

  return { contest };
};
