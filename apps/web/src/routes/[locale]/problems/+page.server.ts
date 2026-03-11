import type { PageServerLoad } from "./$types";
import { listEditableProblems, listProblemCards } from "$lib/server/read-model";

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
