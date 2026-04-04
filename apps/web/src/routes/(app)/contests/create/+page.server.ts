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
  const actor = requireAuth(event);
  const canBindCourse = actor.platformRole === "admin" || actor.platformRole === "teacher";

  const form = await superValidate(zod4(contestFormSchema));
  return { canBindCourse, form };
};

export const actions = {
  create: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);

    const form = await superValidate(event, zod4(contestFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      const {
        problemIdsText,
        ipWhitelistText,
        startsAt,
        endsAt,
        frozenAt,
        courseSlug,
        inviteCode,
        ...rest
      } = form.data;
      const canBindCourse = actor.platformRole === "admin" || actor.platformRole === "teacher";

      const payload = contestCreateSchema.parse({
        ...rest,
        courseSlug: canBindCourse ? courseSlug : undefined,
        inviteCode: inviteCode ?? undefined,
        endsAt: new Date(endsAt).toISOString(),
        frozenAt: frozenAt ? new Date(frozenAt).toISOString() : undefined,
        ipWhitelist: ipWhitelistText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        problemIds: problemIdsText
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
