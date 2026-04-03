import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";
import { contestDomain, checkIpLock, getClientIp } from "@nojv/domain";
import { runTransaction } from "@nojv/db";

const { getContestDetail, getContestParticipationForIpCheck } = contestDomain;

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

      const participation = await getContestParticipationForIpCheck(contest.id, user.id);

      await runTransaction(async (tx) => {
        const ipResult = await checkIpLock(
          tx,
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
      });
    }
  }

  return { contest };
};
