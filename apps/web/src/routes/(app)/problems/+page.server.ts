import type { PageServerLoad } from "./$types";
import { problemDomain } from "@nojv/domain";

const { listEditableProblems, listProblemCards } = problemDomain;

export const load: PageServerLoad = async ({ locals, url }) => {
  const userId = locals.user?.id ?? null;

  const q = url.searchParams.get("q") ?? undefined;
  const difficulty = url.searchParams.get("difficulty") ?? undefined;
  const tagsParam = url.searchParams.get("tags");
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;
  const pageParam = url.searchParams.get("page");
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  const [publicResult, editableProblems] = await Promise.all([
    listProblemCards({ difficulty, page, q, tags, userId }),
    userId ? listEditableProblems(userId) : Promise.resolve(null),
  ]);

  const sessionUser = locals.sessionUser;
  const canCreate =
    !!sessionUser && (sessionUser.platformRole !== "student" || sessionUser.emailVerified);

  return {
    editableProblems,
    publicResult,
    canCreate,
  };
};
