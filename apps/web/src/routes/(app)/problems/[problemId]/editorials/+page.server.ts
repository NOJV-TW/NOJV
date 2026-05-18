import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { editorialDomain, problemDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getProblemRowById } = problemDomain;
const { canViewEditorials, listEditorialsPage } = editorialDomain;

const PAGE_SIZE = 20;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { problemId } = event.params;

  const pageParam = event.url.searchParams.get("page");
  const requestedPage = pageParam ? Number.parseInt(pageParam, 10) : 1;
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // Match the AC gate used by the API: problem lookup and visibility check
  // run in parallel; NotFoundError on the problem takes precedence over the
  // 403 ForbiddenError on the AC gate.
  const [problem, canView] = await Promise.all([
    getProblemRowById(problemId),
    canViewEditorials(actor.userId, problemId),
  ]);

  if (!problem) {
    error(404, "Problem not found.");
  }
  if (!canView && actor.platformRole !== "admin") {
    error(403, "Solve this problem first to view editorials.");
  }

  const {
    items,
    total,
    page: safePage,
    pageSize,
  } = await listEditorialsPage({
    problemId,
    page,
    pageSize: PAGE_SIZE,
  });

  return {
    problem: { id: problem.id, displayId: problem.displayId, title: problem.title },
    actor: {
      userId: actor.userId,
      platformRole: actor.platformRole,
    },
    editorials: items.map((row) => ({
      id: row.id,
      content: row.content,
      language: row.language,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      authorId: row.userId,
      author: { username: row.user.username, name: row.user.name },
    })),
    page: safePage,
    pageSize,
    total,
  };
});
