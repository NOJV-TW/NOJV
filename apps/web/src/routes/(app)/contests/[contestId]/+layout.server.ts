import { error } from "@sveltejs/kit";

import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { contestDomain, proctoringDomain } from "@nojv/application";
import { getActorContext } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = getActorContext(event);
  const contestId = event.params.contestId;

  if (actor) {
    const verdict = await proctoringDomain.checkProctoringGate({
      entityKind: "contest",
      entityId: contestId,
      userId: actor.userId,
    });

    if (!verdict.ok) {
      if (verdict.reason === "not_found") {
        error(404, m.contestShell_notFound());
      }
      if (verdict.reason === "not_published") {
        const contest = await contestDomain.getContestById(contestId);
        if (
          !contest ||
          !contestDomain.canManageContest(actor.userId, contest, actor.platformRole)
        ) {
          error(404, m.contestShell_notFound());
        }
      }
    }
  }

  return { contestId };
});
