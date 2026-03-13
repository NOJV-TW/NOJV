import { courseProblemAttachSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import {
  canManageCourseMembership,
  getCoursePermissionRole,
  requireAuth
} from "$lib/server/auth";
import { attachProblemToCourseRecord } from "$lib/server/course/mutations";

const attachFormSchema = courseProblemAttachSchema.omit({ courseSlug: true });

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();
  const form = await superValidate(zod4(attachFormSchema));

  return {
    courseSlug: params.slug,
    courseTitle: courseData.course.title,
    problems: courseData.problems,
    form
  };
};

export const actions = {
  attach: async (event) => {
    const actor = requireAuth(event);
    const slug = event.params.slug;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canManageCourseMembership(role)) {
      return fail(403, { error: "Only course staff can attach problems to a course." });
    }

    const form = await superValidate(event, zod4(attachFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      const payload = courseProblemAttachSchema.parse({
        ...form.data,
        courseSlug: slug
      });
      await attachProblemToCourseRecord(actor, payload);
      return message(form, `Attached ${payload.problemSlug} to course.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Problem attachment failed.";
      return fail(400, { form, error: msg });
    }
  }
} satisfies Actions;
