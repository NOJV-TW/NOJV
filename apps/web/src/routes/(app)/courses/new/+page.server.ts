import { courseCreateSchema } from "@nojv/core";
import { courseDomain } from "@nojv/domain";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { canCreateCourse, requireAuth } from "$lib/server/auth";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";

const { createCourseRecord } = courseDomain;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  if (!canCreateCourse(actor.platformRole)) {
    redirect(303, "/courses");
  }
  const form = await superValidate(zod4(courseCreateSchema));
  return { form };
};

export const actions = {
  default: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    if (!canCreateCourse(actor.platformRole)) {
      redirect(303, "/courses");
    }

    const form = await superValidate(event, zod4(courseCreateSchema));
    if (!form.valid) return fail(400, { form });

    let createdCourseId: string;
    try {
      const { course } = await createCourseRecord(actor, form.data);
      createdCourseId = course.id;
    } catch (err) {
      const classified = classifyError(err);
      return message(form, { kind: "error", text: classified.message }, { status: 400 });
    }

    redirect(303, `/courses/${createdCourseId}`);
  },
} satisfies Actions;
