import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { examDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { listExamsAcrossCoursesForUser } = examDomain;
type ExamAcrossStatusFilter = examDomain.ExamAcrossStatusFilter;

function parseStatusFilter(raw: string | null): ExamAcrossStatusFilter {
  switch (raw) {
    case "running":
    case "upcoming":
    case "ended":
      return raw;
    case "all":
    default:
      return "all";
  }
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const currentFilter = parseStatusFilter(event.url.searchParams.get("tab"));

  const { rows, counts } = await listExamsAcrossCoursesForUser(actor.userId, {
    status: currentFilter
  });

  return {
    exams: rows,
    counts,
    currentFilter
  };
});
