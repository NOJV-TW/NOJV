import type { PageServerLoad } from "./$types";
import { listEditableProblems, listProblemCards } from "$lib/server/queries";

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id ?? null;

  const [publicProblems, editableProblems] = await Promise.all([
    listProblemCards(),
    userId ? listEditableProblems(userId) : Promise.resolve(null)
  ]);

  return {
    editableProblems,
    publicProblems,
    showCreate: !!userId
  };
};
