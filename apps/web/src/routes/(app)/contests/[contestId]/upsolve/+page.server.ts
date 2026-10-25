import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "#lib/server/auth.js";
import { handleLoad } from "#lib/server/shared/load-wrapper.js";
import { contestDomain } from "@nojv/application";

const { getUpsolveView } = contestDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const view = await getUpsolveView(event.params.contestId, actor.userId);
  return { view };
});
