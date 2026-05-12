import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { ForbiddenError } from "@nojv/domain";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { loadPlagiarismPair } from "$lib/server/plagiarism-pair";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  requireAuth(event);
  const parent = await event.parent();
  const { assessment, isManager } = parent;
  if (!isManager) {
    throw new ForbiddenError("Only course staff can view plagiarism diff.");
  }

  return loadPlagiarismPair({
    pairId: event.params.pairId,
    target: { type: "courseAssessment", id: assessment.id },
    flagContext: "assessment",
  });
});
