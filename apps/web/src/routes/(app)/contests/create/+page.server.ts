import { contestCreateSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { contestDomain } from "@nojv/domain";

const { createContestRecord, contestFormSchema } = contestDomain;

export const load: PageServerLoad = async (event) => {
  requireAuth(event);
  const form = await superValidate(zod4(contestFormSchema));
  return { form };
};

export const actions = {
  create: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);

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
      const result = await createContestRecord(actor, payload);
      return message(form, { kind: "success", text: `Contest "${result.title}" created.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Contest creation failed.";
      return message(form, { kind: "error", text: msg }, { status: 400 });
    }
  },
} satisfies Actions;
