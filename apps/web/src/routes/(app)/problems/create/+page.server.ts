import { error, fail, redirect } from "@sveltejs/kit";
import { problemCreateSchema } from "@nojv/core";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { problemDomain } from "@nojv/domain";

const { createProblemRecord } = problemDomain;

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/problems");
  }

  const form = await superValidate(zod4(problemCreateSchema));
  return { form };
};

export const actions: Actions = {
  create: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);

    // Students must have verified school email; teachers/admins can always create
    if (actor.platformRole === "student" && !actor.emailVerified) {
      error(403, "Please verify your school email before creating problems.");
    }

    const form = await superValidate(event, zod4(problemCreateSchema));
    if (!form.valid) return fail(400, { form });

    // Force draft status on creation — full editing happens in the edit page
    const result = await createProblemRecord(actor, { ...form.data, status: "draft" });

    return { form, slug: result.slug, success: true };
  }
};
