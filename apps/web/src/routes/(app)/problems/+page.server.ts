import type { PageServerLoad } from "./$types";
import {
  listEditableProblems,
  listProblemCards,
  listSolvedProblemSlugs
} from "$lib/server/problem/queries";

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id ?? null;

  const [publicProblems, editableProblems, solvedSlugs] = await Promise.all([
    listProblemCards(),
    userId ? listEditableProblems(userId) : Promise.resolve(null),
    userId ? listSolvedProblemSlugs(userId) : Promise.resolve([])
  ]);

  return {
    editableProblems,
    publicProblems,
    showCreate: !!userId,
    solvedSlugs
  };
};
