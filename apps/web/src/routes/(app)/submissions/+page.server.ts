import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { submissionDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { listUserSubmissions } = submissionDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const submissions = await listUserSubmissions(actor.userId);
  return { submissions };
});
