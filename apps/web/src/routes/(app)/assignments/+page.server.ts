import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { courseDomain } from "@nojv/application";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { listAssignmentsAcrossCoursesForUser } = courseDomain;
type AssignmentsTopStatusFilter = courseDomain.AssignmentsTopStatusFilter;

function parseStatusFilter(raw: string | null): AssignmentsTopStatusFilter {
  switch (raw) {
    case "open":
    case "upcoming":
    case "closed":
      return raw;
    case "all":
    default:
      return "all";
  }
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const currentFilter = parseStatusFilter(event.url.searchParams.get("tab"));

  const { rows, counts, hasNoCourses } = await listAssignmentsAcrossCoursesForUser(
    actor.userId,
    { status: currentFilter },
  );

  return {
    assignments: rows,
    counts,
    currentFilter,
    hasNoCourses,
  };
});
