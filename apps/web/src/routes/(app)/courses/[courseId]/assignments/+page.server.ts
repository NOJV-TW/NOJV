import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { courseDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { listAssignmentsForCourse } = courseDomain;
type AssignmentStatusFilter = courseDomain.AssignmentStatusFilter;

const LIST_LIMIT = 50;

function parseStatusFilter(raw: string | null, isManager: boolean): AssignmentStatusFilter {
  switch (raw) {
    case "open":
    case "upcoming":
    case "closed":
      return raw;
    case "draft":
      // Students never see draft — coerce to `all` if the URL is poked.
      return isManager ? "draft" : "all";
    case "all":
    default:
      return "all";
  }
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { course, isManager } = parent;
  const actor = requireAuth(event);

  const currentFilter = parseStatusFilter(event.url.searchParams.get("status"), isManager);

  const { rows: assignments, counts } = await listAssignmentsForCourse(course.id, {
    status: currentFilter,
    includeDrafts: isManager,
    forUserId: actor.userId,
    limit: LIST_LIMIT,
  });

  return {
    assignments,
    counts,
    currentFilter,
    canCreate: isManager,
  };
});
