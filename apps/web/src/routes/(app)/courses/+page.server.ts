import { courseCreateSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { canCreateCourse, getActorContext, requireAuth } from "$lib/server/auth";
import { createCourseRecord } from "$lib/server/course/mutations";
import { listCourseCards, listUserCourseCards } from "$lib/server/course/queries";

export const load: PageServerLoad = async (event) => {
  const actor = getActorContext(event);
  const isStaff = actor ? canCreateCourse(actor.platformRole) : false;

  const courses = isStaff
    ? await listCourseCards()
    : actor
      ? await listUserCourseCards(actor.userId)
      : [];

  return { courses };
};

export const actions = {
  create: async (event) => {
    const actor = await requireAuth(event);

    if (!canCreateCourse(actor.platformRole)) {
      return fail(403, { error: "Only teachers or admins can create courses." });
    }

    try {
      const formData = await event.request.formData();
      const payload = courseCreateSchema.parse(JSON.parse(formData.get("data") as string));
      const result = await createCourseRecord(actor, payload);
      return { success: true, course: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Course creation failed.";
      return fail(400, { error: message });
    }
  }
} satisfies Actions;
