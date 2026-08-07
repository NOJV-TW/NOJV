import type { PageServerLoad } from "./$types";
import { problemDomain } from "@nojv/application";
import { getActorContext } from "$lib/server/auth";
import { parseProblemListQuery } from "$lib/server/shared/problem-list-query";

const { listAdminProblems, listEditableProblems, listProblemCards } = problemDomain;

export const load: PageServerLoad = async ({ locals, url }) => {
  const userId = locals.user?.id ?? null;
  const params = parseProblemListQuery(url);
  const actor = getActorContext({ locals });

  const [publicResult, editableProblems, adminProblems] = await Promise.all([
    listProblemCards({ ...params, userId }),
    userId ? listEditableProblems(userId, params.sort) : Promise.resolve(null),
    actor?.platformRole === "admin" ? listAdminProblems(params.sort) : Promise.resolve(null),
  ]);

  const canCreate = !!actor && (await problemDomain.canAuthorProblems(actor));

  return {
    editableProblems,
    adminProblems,
    publicResult,
    canCreate,
    isAdmin: actor?.platformRole === "admin",
    loggedIn: userId !== null,
    advancedCreationAllowed: !!actor && (await problemDomain.canCreateAdvancedProblems(actor)),
  };
};
