import { courseUpdateSchema } from "@nojv/core";
import { courseDomain } from "@nojv/domain";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";

const { findCourseWithMembership, updateCourse, deleteCourse } = courseDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { course, isManager } = parent;

  if (!isManager) {
    redirect(302, `/courses/${course.id}`);
  }

  // The layout loader's course shape doesn't include `description`, so
  // we refetch with the membership include. This also gives us the raw
  // row used to prefill the edit form.
  const fullCourse = await findCourseWithMembership(course.id, actor.userId);
  if (!fullCourse) {
    redirect(302, `/courses/${course.id}`);
  }

  const form = await superValidate(
    {
      description: fullCourse.description,
      title: fullCourse.title
    },
    zod4(courseUpdateSchema)
  );

  return {
    form,
    courseDescription: fullCourse.description
  };
});

export const actions = {
  updateInfo: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    const form = await superValidate(event, zod4(courseUpdateSchema));
    if (!form.valid) return fail(400, { form });

    try {
      await updateCourse(actor, courseId, form.data);
    } catch (err) {
      const classified = classifyError(err);
      return message(form, { kind: "error", text: classified.message }, { status: 400 });
    }

    return message(form, { kind: "success", text: "ok" });
  },

  copyCourse: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    requireAuth(event);

    // Copy-course belongs to a future task; the danger-zone button is
    // wired to this action so the UI can show the unavailable banner
    // using a real SvelteKit form response instead of client-only state.
    return fail(501, { error: "copy_unavailable" });
  },

  deleteCourse: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    // Refetch the course row to compare against the typed confirmation.
    // Trusting a client-sent hidden title field would defeat the point
    // of the confirmation step.
    const course = await findCourseWithMembership(courseId, actor.userId);
    if (!course) {
      return fail(404, { error: "not_found" });
    }

    const formData = await event.request.formData();
    const typed = formData.get("typedConfirmation");
    if (typeof typed !== "string" || typed !== course.title) {
      return fail(400, { error: "delete_mismatch" });
    }

    try {
      await deleteCourse(actor, courseId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    redirect(303, "/courses");
  }
} satisfies Actions;
