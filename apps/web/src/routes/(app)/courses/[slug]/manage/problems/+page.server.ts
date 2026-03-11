import { courseProblemAttachSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { canManageCourseMembership, getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { attachProblemToCourseRecord } from "$lib/server/course/mutations";

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();

  return {
    courseSlug: params.slug,
    courseTitle: courseData.course.title,
    problems: courseData.problems
  };
};

export const actions = {
  attach: async (event) => {
    const actor = await requireAuth(event);
    const slug = event.params.slug;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canManageCourseMembership(role)) {
      return fail(403, { error: "Only course staff can attach problems to a course." });
    }

    try {
      const formData = await event.request.formData();
      const data = JSON.parse(formData.get("data") as string);
      const payload = courseProblemAttachSchema.parse({
        ...data,
        courseSlug: slug
      });
      const result = await attachProblemToCourseRecord(actor, payload);
      return { success: true, problem: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Problem attachment failed.";
      return fail(400, { error: message });
    }
  }
} satisfies Actions;
