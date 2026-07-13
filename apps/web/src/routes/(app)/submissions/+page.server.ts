import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { submissionDomain } from "@nojv/application";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { listUserSubmissions } = submissionDomain;

const PAGE_SIZE = 50;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { items, nextCursor } = await listUserSubmissions({
    actor,
    limit: PAGE_SIZE,
  });
  return { submissions: items, nextCursor };
});
