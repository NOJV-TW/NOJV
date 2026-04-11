import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { contestDomain, getClientIp } from "@nojv/domain";

const { getContestDetail, getContestParticipationForIpCheck, checkContestIpAccess } =
  contestDomain;
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(
  async ({ params, locals, request }: PageServerLoadEvent) => {
    const now = new Date();
    const user = locals.user;

    const contest = await getContestDetail(params.slug, {
      userId: user?.id ?? null,
      now
    });

    if (user && (contest.ipWhitelistEnabled || contest.ipBindingEnabled)) {
      const isActive = new Date(contest.startsAt) <= now && now <= new Date(contest.endsAt);

      if (isActive) {
        const clientIp = getClientIp(request);

        const participation = await getContestParticipationForIpCheck(contest.id, user.id);

        const ipResult = await checkContestIpAccess(
          contest,
          clientIp,
          contest.id,
          user.id,
          participation
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
  }
);
