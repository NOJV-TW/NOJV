import { courseCreateSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { canCreateCourse, getActorContext, requireAuth } from "$lib/server/auth";
import { createCourseRecord } from "$lib/server/course/mutations";
import { listCourseCards } from "$lib/server/course/queries";

export const load: PageServerLoad = async (event) => {
  const actor = getActorContext(event);
  const isStaff = actor ? canCreateCourse(actor.platformRole) : false;

  const courses = isStaff
    ? await listCourseCards()
    : actor
      ? await listCourseCards(actor.userId)
      : [];

  const form = await superValidate(zod4(courseCreateSchema));

  return { courses, form };
};

export const actions = {
  create: async (event) => {
    const actor = requireAuth(event);

    if (!canCreateCourse(actor.platformRole)) {
      return fail(403, { error: "Only teachers or admins can create courses." });
    }

    const form = await superValidate(event, zod4(courseCreateSchema));
    if (!form.valid) return fail(400, { form });

    try {
      await createCourseRecord(actor, form.data);
      return message(form, "Course created.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Course creation failed.";
      return fail(400, { form, error: msg });
    }
  }
} satisfies Actions;
