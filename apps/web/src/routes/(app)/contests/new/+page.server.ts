import { contestCreateSchema } from "@nojv/core";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { canCreateCourse, requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { contestDomain } from "@nojv/domain";

const { createContestRecord, contestFormSchema } = contestDomain;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  if (!canCreateCourse(actor.platformRole)) {
    redirect(303, "/contests");
  }
  const form = await superValidate(zod4(contestFormSchema));
  return { form };
};

export const actions = {
  create: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    if (!canCreateCourse(actor.platformRole)) {
      redirect(303, "/contests");
    }

    const form = await superValidate(event, zod4(contestFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      const { problemIdsText, startsAt, endsAt, frozenAt, inviteCode, ...rest } = form.data;

      const payload = contestCreateSchema.parse({
        ...rest,
        inviteCode: inviteCode ?? undefined,
        endsAt: new Date(endsAt).toISOString(),
        frozenAt: frozenAt ? new Date(frozenAt).toISOString() : undefined,
        problemIds: problemIdsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        startsAt: new Date(startsAt).toISOString(),
      });
      await createContestRecord(actor, payload);
      return message(form, { kind: "success", text: "ok" });
    } catch {
      return message(form, { kind: "error", text: "error" }, { status: 400 });
    }
  }),
} satisfies Actions;
