import type { PageServerLoad } from "./$types";
import { problemDomain } from "@nojv/application";
import { getActorContext } from "$lib/server/auth";
import { isAdvancedModeSupported } from "$lib/server/execution-backend";
import { parseProblemListQuery } from "$lib/server/shared/problem-list-query";

const { listEditableProblems, listProblemCards } = problemDomain;

export const load: PageServerLoad = async ({ locals, url }) => {
  const userId = locals.user?.id ?? null;
  const params = parseProblemListQuery(url);

  const [publicResult, editableProblems] = await Promise.all([
    listProblemCards({ ...params, userId }),
    userId ? listEditableProblems(userId, params.sort) : Promise.resolve(null),
  ]);

  const actor = getActorContext({ locals });
  const canCreate = !!actor && (await problemDomain.canAuthorProblems(actor));

  return {
    editableProblems,
    publicResult,
    canCreate,
    loggedIn: userId !== null,
    advancedModeSupported: isAdvancedModeSupported(),
  };
};
