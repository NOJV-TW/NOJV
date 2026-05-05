import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { courseDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const {
  listRecentAnnouncementsForCourse,
  listAssignmentOverviewForCourse,
  listExamOverviewForCourse,
} = courseDomain;

const ANNOUNCEMENT_LIMIT = 5;
const ASSESSMENT_LIMIT = 3;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { course, isManager, counts } = parent;
  const now = new Date();

  const [announcements, assignments, exams] = await Promise.all([
    listRecentAnnouncementsForCourse(course.id, ANNOUNCEMENT_LIMIT, actor),
    listAssignmentOverviewForCourse(course.id, {
      limit: ASSESSMENT_LIMIT,
      isManager,
      forUserId: actor.userId,
      now,
    }),
    listExamOverviewForCourse(course.id, {
      limit: ASSESSMENT_LIMIT,
      isManager,
      forUserId: actor.userId,
      now,
    }),
  ]);

  const totalStudents = counts.members;
  const examsWithClassTotals = exams.map((exam) => ({
    ...exam,
    totalStudents,
  }));

  return {
    announcements,
    assignments,
    exams: examsWithClassTotals,
    totalStudents,
  };
});
