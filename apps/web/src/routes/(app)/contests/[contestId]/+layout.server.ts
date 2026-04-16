import { error } from "@sveltejs/kit";

import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { proctoringDomain } from "@nojv/domain";
import { getActorContext } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

/**
 * Contest shell gate.
 *
 * Runs the shared `checkProctoringGate` introduced in Phase 3. We only treat
 * IP-based verdicts as hard blocks here: the landing page (`+page.svelte`)
 * renders its own pre-start / post-end UI (status badges, countdown, practice
 * redirect) and the problems sub-route already enforces time-window access
 * via `getContestWorkspaceData`. Running the full gate at the layout level
 * would prematurely 4xx visitors of the landing, breaking the countdown UX.
 *
 * `not_found` / `not_published` map to 404. Anonymous visitors skip the gate
 * entirely — standalone contests allow public browsing of the landing and
 * scoreboard.
 */
export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = getActorContext(event);
  const contestId = event.params.contestId;

  if (actor) {
    const verdict = await proctoringDomain.checkProctoringGate({
      entityKind: "contest",
      entityId: contestId,
      userId: actor.userId,
      ip: event.getClientAddress()
    });

    if (!verdict.ok) {
      if (verdict.reason === "not_found" || verdict.reason === "not_published") {
        error(404, m.contestShell_notFound());
      }
      if (verdict.reason === "ip_whitelist" || verdict.reason === "ip_binding") {
        error(403, m.contestShell_ipBlocked());
      }
      // `not_started` / `ended` are soft — the landing page renders the
      // countdown or post-contest shell. Participation-level enforcement
      // lives on the problems sub-route.
    }
  }

  return { contestId };
});
