import { manualCourseEnrollmentSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { canManageCourseMembership, getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { manuallyEnrollCourseMember } from "$lib/server/db";

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();

  return {
    courseSlug: params.slug,
    courseTitle: courseData.course.title,
    members: courseData.course.members
  };
};

export const actions = {
  enroll: async (event) => {
    const actor = await requireAuth(event);
    const slug = event.params.slug;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canManageCourseMembership(role)) {
      return fail(403, { error: "Only course staff can manage members." });
    }

    try {
      const formData = await event.request.formData();
      const data = JSON.parse(formData.get("data") as string);
      const payload = manualCourseEnrollmentSchema.parse({
        ...data,
        courseSlug: slug
      });
      const result = await manuallyEnrollCourseMember(actor, payload);
      return { success: true, member: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Manual enrollment failed.";
      return fail(400, { error: message });
    }
  }
} satisfies Actions;
