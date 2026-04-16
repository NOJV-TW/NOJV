import { error } from "@sveltejs/kit";

import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { proctoringDomain } from "@nojv/domain";
import { getActorContext } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

/**
 * Contest shell gate.
 *
 * Runs the shared `checkProctoringGate` for existence + visibility. Contests
 * have no proctoring (IP binding / whitelist / page lock live on `Exam` only),
 * so the gate here is essentially "does this contest exist and is it
 * published". `not_started` / `ended` are soft: the landing page
 * (`+page.svelte`) renders its own countdown / post-contest shell, so we
 * don't 4xx here and break the UX. Anonymous visitors skip the gate entirely
 * — standalone contests allow public browsing of the landing and scoreboard.
 */
export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = getActorContext(event);
  const contestId = event.params.contestId;

  if (actor) {
    const verdict = await proctoringDomain.checkProctoringGate({
      entityKind: "contest",
      entityId: contestId,
      userId: actor.userId
    });

    if (!verdict.ok) {
      if (verdict.reason === "not_found" || verdict.reason === "not_published") {
        error(404, m.contestShell_notFound());
      }
      // `not_started` / `ended` are soft — the landing page renders the
      // countdown or post-contest shell. Participation-level enforcement
      // lives on the problems sub-route.
    }
  }

  return { contestId };
});
