import { contestCreateSchema } from "@nojv/core";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { canCreateCourse, requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { contestDomain } from "@nojv/application";

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
  create: withAction(async (event) => {
    const actor = requireAuth(event);
    if (!canCreateCourse(actor.platformRole)) {
      redirect(303, "/contests");
    }

    const form = await superValidate(event, zod4(contestFormSchema));
    if (!form.valid) return fail(400, { form });

    const { startsAt, endsAt, frozenAt, inviteCode, ...rest } = form.data;

    const payload = contestCreateSchema.parse({
      ...rest,
      inviteCode: inviteCode ?? undefined,
      endsAt: new Date(endsAt).toISOString(),
      frozenAt: frozenAt ? new Date(frozenAt).toISOString() : undefined,
      startsAt: new Date(startsAt).toISOString(),
    });
    await createContestRecord(actor, payload);
    return message(form, { kind: "success", text: "ok" });
  }),
} satisfies Actions;
