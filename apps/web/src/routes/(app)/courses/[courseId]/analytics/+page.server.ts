import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { courseDomain, ForbiddenError } from "@nojv/domain";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getCourseAnalytics } = courseDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const { course, isManager } = await event.parent();

  // Analytics is staff-only — `isManager` from the course layout is true for
  // teachers, TAs, the course owner, and platform admins.
  if (!isManager) {
    throw new ForbiddenError("Only course staff can view class analytics.");
  }

  const analytics = await getCourseAnalytics(course.id);

  return { analytics };
});
