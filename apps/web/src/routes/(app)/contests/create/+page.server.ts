import { contestCreateSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { createContestRecord } from "$lib/server/contest/mutations";
import { contestFormSchema } from "$lib/server/contest/schemas";

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  const canBindCourse = actor.platformRole === "admin" || actor.platformRole === "teacher";

  const form = await superValidate(zod4(contestFormSchema));
  return { canBindCourse, form };
};

export const actions = {
  create: async (event) => {
    const actor = requireAuth(event);

    const form = await superValidate(event, zod4(contestFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      const { problemSlugsText, startsAt, endsAt, frozenAt, courseSlug, inviteCode, ...rest } = form.data;
      const canBindCourse = actor.platformRole === "admin" || actor.platformRole === "teacher";

      const payload = contestCreateSchema.parse({
        ...rest,
        courseSlug: canBindCourse ? courseSlug : undefined,
        inviteCode: inviteCode || undefined,
        endsAt: new Date(endsAt).toISOString(),
        frozenAt: frozenAt ? new Date(frozenAt).toISOString() : undefined,
        problemSlugs: problemSlugsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        startsAt: new Date(startsAt).toISOString()
      });
      const result = await createContestRecord(actor, payload);
      return message(form, `Contest "${result.title}" created.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Contest creation failed.";
      return fail(400, { form, error: msg });
    }
  }
} satisfies Actions;
