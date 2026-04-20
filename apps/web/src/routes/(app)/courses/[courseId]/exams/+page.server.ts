import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { examDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { listForCourse } = examDomain;
type ExamStatusFilter = examDomain.ExamStatusFilter;

const LIST_LIMIT = 50;

function parseStatusFilter(raw: string | null, isManager: boolean): ExamStatusFilter {
  switch (raw) {
    case "upcoming":
    case "running":
    case "ended":
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

  const { rows: exams, counts } = await listForCourse(course.id, {
    status: currentFilter,
    includeDrafts: isManager,
    forUserId: actor.userId,
    limit: LIST_LIMIT,
  });

  // totalStudents is stamped in once per page so every row can render
  // "N/total" without the domain layer re-counting memberships per row.
  const totalStudents = course.studentCount;
  const rowsWithTotal = exams.map((row) => ({ ...row, totalStudents }));

  return {
    exams: rowsWithTotal,
    counts,
    currentFilter,
    canCreate: isManager,
  };
});
