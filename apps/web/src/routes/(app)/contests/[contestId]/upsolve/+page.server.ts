import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { contestDomain } from "@nojv/domain";

const { getUpsolveView } = contestDomain;

/**
 * Post-contest upsolve index. `getUpsolveView` throws `NotFoundError` when the
 * contest is unpublished or has not yet ended; `handleLoad` maps that to a 404,
 * so the route is invisible until `now >= endsAt`.
 */
export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const view = await getUpsolveView(event.params.contestId, actor.userId);
  return { view };
});
