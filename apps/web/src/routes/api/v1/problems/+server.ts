import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { problemDomain } from "@nojv/domain";
import { apiHandler } from "$lib/server/shared/api-handler";

const { listProblemCards } = problemDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  const q = event.url.searchParams.get("q") ?? undefined;
  const difficulty = event.url.searchParams.get("difficulty") ?? undefined;
  const tagsParam = event.url.searchParams.get("tags");
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;
  const pageParam = event.url.searchParams.get("page");
  const page = pageParam ? Math.max(1, Number.parseInt(pageParam, 10) || 1) : 1;
  const sort = event.url.searchParams.get("sort") === "desc" ? "desc" : "asc";

  const result = await listProblemCards({
    difficulty,
    page,
    q,
    sort,
    tags,
    userId: null,
  });

  return json(result);
});
