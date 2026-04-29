import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { problemDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getEditorialById, getProblemRowById } = problemDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { id } = event.params;

  const editorial = await getEditorialById(id);
  if (!editorial) {
    error(404, "Editorial not found.");
  }

  const isAuthor = editorial.userId === actor.userId;
  const isAdmin = actor.platformRole === "admin";
  if (!isAuthor && !isAdmin) {
    // 404 (not 403) so non-staff probes can not enumerate other authors'
    // ids — matches the API-layer NotFoundError contract.
    error(404, "Editorial not found.");
  }

  const problem = await getProblemRowById(editorial.problemId);

  return {
    editorial: {
      id: editorial.id,
      content: editorial.content,
      language: editorial.language,
      problemId: editorial.problemId,
    },
    problem: problem ? { id: problem.id, title: problem.title } : null,
  };
});
