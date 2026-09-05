import { contestCreateSchema } from "@nojv/core";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { canCreateCourse, requireAuth } from "$lib/server/auth";
import { classifyRequestError } from "$lib/server/shared/handle-action-error";
import { withAction } from "$lib/server/shared/action-handlers";
import { contestDomain, problemDomain } from "@nojv/application";

const { createContestRecord, contestFormSchema } = contestDomain;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  if (!canCreateCourse(actor.platformRole)) {
    redirect(303, "/contests");
  }
  const [form, candidateProblems] = await Promise.all([
    superValidate(zod4(contestFormSchema), { errors: false }),
    problemDomain.listProblemPickerGroups(actor.userId),
  ]);
  return { form, candidateProblems };
};

export const actions = {
  create: withAction(async (event) => {
    const actor = requireAuth(event);
    if (!canCreateCourse(actor.platformRole)) {
      redirect(303, "/contests");
    }

    const form = await superValidate(event, zod4(contestFormSchema));
    if (!form.valid) return fail(400, { form });

    const { startsAt, endsAt, frozenAt, freezeMinutes, inviteCode, isPublic, ...rest } =
      form.data;

    try {
      const payload = contestCreateSchema.parse({
        ...rest,
        inviteCode: isPublic ? undefined : (inviteCode ?? undefined),
        endsAt: new Date(endsAt).toISOString(),
        frozenAt:
          freezeMinutes != null
            ? new Date(new Date(endsAt).getTime() - freezeMinutes * 60_000).toISOString()
            : frozenAt
              ? new Date(frozenAt).toISOString()
              : undefined,
        startsAt: new Date(startsAt).toISOString(),
      });
      await createContestRecord(actor, payload);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    return message(form, { kind: "success", text: "ok" });
  }),
} satisfies Actions;
