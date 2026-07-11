import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { courseDomain } from "@nojv/application";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { buildCourseGradebook } = courseDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { course, isManager } = await event.parent();

  const gradebook = await buildCourseGradebook(
    course.id,
    isManager ? undefined : { forUserId: actor.userId },
  );

  return { gradebook };
});
