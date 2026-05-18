import { copyCourseSchema, courseUpdateSchema } from "@nojv/core";
import { courseDomain } from "@nojv/domain";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { withRateLimit } from "$lib/server/shared/action-handlers";

const {
  findCourseWithMembership,
  updateCourse,
  deleteCourse,
  setCourseArchived,
  copyCourse,
  getCopyCoursePreview,
} = courseDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { course, isManager } = parent;

  if (!isManager) {
    redirect(302, `/courses/${course.id}`);
  }

  const fullCourse = await findCourseWithMembership(course.id, actor.userId);
  if (!fullCourse) {
    redirect(302, `/courses/${course.id}`);
  }

  const [form, copyPreview] = await Promise.all([
    superValidate(
      {
        description: fullCourse.description,
        title: fullCourse.title,
        academicYear: fullCourse.academicYear,
        semester: fullCourse.semester,
      },
      zod4(courseUpdateSchema),
    ),
    getCopyCoursePreview(course.id),
  ]);

  return {
    form,
    courseDescription: fullCourse.description,
    archived: fullCourse.archived,
    copyPreview,
  };
});

export const actions = {
  updateInfo: withRateLimit(async (event) => {
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
  }),

  copyCourse: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    const formData = await event.request.formData();
    const parsed = copyCourseSchema.safeParse({ newTitle: formData.get("newTitle") });
    if (!parsed.success) {
      return fail(400, { error: "invalid_title" });
    }

    let newCourseId: string;
    try {
      const result = await copyCourse(actor, courseId, parsed.data.newTitle);
      newCourseId = result.newCourseId;
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    redirect(303, `/courses/${newCourseId}/settings`);
  }),

  toggleArchive: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    const formData = await event.request.formData();
    const next = formData.get("archived") === "true";

    try {
      await setCourseArchived(actor, courseId, next);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }

    return { archived: next };
  }),

  deleteCourse: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;

    // Compare typed confirmation against the server-side row — a hidden form field would defeat the check.
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
  }),
} satisfies Actions;
