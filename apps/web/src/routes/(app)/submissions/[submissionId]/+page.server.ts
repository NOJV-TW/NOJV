import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { submissionDomain } from "@nojv/domain";

const { getSubmissionDetail } = submissionDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { submissionId } = event.params;
  if (!submissionId) error(400, "Missing submissionId.");

  const submission = await getSubmissionDetail(actor, submissionId);
  return { submission };
});
