import { redirect } from "@sveltejs/kit";
import { problemCreateSchema } from "@nojv/core";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth, ForbiddenError } from "$lib/server/auth";
import { createProblemRecord, createProblemTestcaseSetRecord } from "$lib/server/db";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/problems");
  }

  return {};
};

export const actions: Actions = {
  create: async (event) => {
    const actor = await requireAuth(event);

    if (actor.platformRole === "student") {
      throw new ForbiddenError("Only teachers and admins can create problems.");
    }

    const formData = await event.request.formData();
    const payload = problemCreateSchema.parse(JSON.parse(formData.get("data") as string));
    const result = await createProblemRecord(actor, payload);

    return { slug: result.slug, success: true };
  },

  createTestcaseSet: async (event) => {
    const actor = await requireAuth(event);
    const formData = await event.request.formData();
    const slug = formData.get("slug") as string;
    const payload = JSON.parse(formData.get("data") as string);
    const result = await createProblemTestcaseSetRecord(actor, slug, payload);

    return { id: result.id, success: true };
  }
};
