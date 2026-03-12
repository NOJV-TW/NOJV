import { error, fail, redirect } from "@sveltejs/kit";
import { problemCreateSchema, problemTestcaseSetCreateSchema } from "@nojv/core";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import {
  createProblemRecord,
  createProblemTestcaseSetRecord
} from "$lib/server/problem/mutations";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/problems");
  }

  const form = await superValidate(zod4(problemCreateSchema));
  return { form };
};

export const actions: Actions = {
  create: async (event) => {
    const actor = await requireAuth(event);

    if (actor.platformRole === "student") {
      error(403, "Only teachers and admins can create problems.");
    }

    const form = await superValidate(event, zod4(problemCreateSchema));
    if (!form.valid) return fail(400, { form });

    const result = await createProblemRecord(actor, form.data);

    return { form, slug: result.slug, success: true };
  },

  createTestcaseSet: async (event) => {
    const actor = await requireAuth(event);
    const formData = await event.request.formData();
    const slugField = formData.get("slug");
    if (typeof slugField !== "string" || slugField.length === 0) error(400, "Missing slug");
    const raw = formData.get("data");
    if (typeof raw !== "string") error(400, "Missing data field");
    const payload = problemTestcaseSetCreateSchema.parse(JSON.parse(raw));
    const result = await createProblemTestcaseSetRecord(actor, slugField, payload);

    return { id: result.id, success: true };
  }
};
