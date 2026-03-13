import { manualCourseEnrollmentSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import {
  canManageCourseMembership,
  getCoursePermissionRole,
  requireAuth
} from "$lib/server/auth";
import { manuallyEnrollCourseMember } from "$lib/server/course/mutations";

const enrollFormSchema = manualCourseEnrollmentSchema.omit({ courseSlug: true });

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();
  const form = await superValidate(zod4(enrollFormSchema));

  return {
    courseSlug: params.slug,
    courseTitle: courseData.course.title,
    members: courseData.course.members,
    form
  };
};

export const actions = {
  enroll: async (event) => {
    const actor = requireAuth(event);
    const slug = event.params.slug;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canManageCourseMembership(role)) {
      return fail(403, { error: "Only course staff can manage members." });
    }

    const form = await superValidate(event, zod4(enrollFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      const payload = manualCourseEnrollmentSchema.parse({
        ...form.data,
        courseSlug: slug
      });
      await manuallyEnrollCourseMember(actor, payload);
      return message(form, `Enrolled ${payload.displayName}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Manual enrollment failed.";
      return fail(400, { form, error: msg });
    }
  }
} satisfies Actions;
