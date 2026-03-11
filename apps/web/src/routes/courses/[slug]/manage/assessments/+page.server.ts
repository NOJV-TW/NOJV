import { courseAssessmentCreateSchema } from "@nojv/domain";
import { fail } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { canPublishAssessment, getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { createCourseAssessmentRecord } from "$lib/server/db";

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();

  return {
    assessments: courseData.course.assessments,
    courseSlug: params.slug,
    problemSlugs: courseData.course.problemSlugs
  };
};

export const actions = {
  create: async (event) => {
    const actor = await requireAuth(event);
    const slug = event.params.slug;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canPublishAssessment(role)) {
      return fail(403, { error: "Only course staff can publish assignments or exams." });
    }

    try {
      const formData = await event.request.formData();
      const data = JSON.parse(formData.get("data") as string);
      const payload = courseAssessmentCreateSchema.parse({
        ...data,
        courseSlug: slug
      });
      const result = await createCourseAssessmentRecord(actor, payload);
      return { success: true, assessment: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Assessment publish failed.";
      return fail(400, { error: message });
    }
  }
} satisfies Actions;
