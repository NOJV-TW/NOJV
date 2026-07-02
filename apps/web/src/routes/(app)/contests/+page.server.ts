import { fail, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { getActorContext, requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { readString } from "$lib/server/shared/form-utils";
import { contestDomain } from "@nojv/application";

const { joinContestByCode, listContestsForUser } = contestDomain;

export const load: PageServerLoad = async (event) => {
  const actor = getActorContext(event);
  const { managed, participable } = await listContestsForUser(actor?.userId ?? null);
  return { managed, participable, loggedIn: actor != null };
};

export const actions = {
  joinByCode: withAction(async (event) => {
    const actor = requireAuth(event);

    const formData = await event.request.formData();
    const code = readString(formData, "code");

    if (!code) {
      return fail(400, { codeError: m.contestsList_codeErrorEmpty() });
    }

    let contestId: string;
    try {
      ({ contestId } = await joinContestByCode(actor, code));
    } catch {
      return fail(404, { codeError: m.contestsList_codeErrorInvalid() });
    }

    redirect(303, `/contests/${contestId}`);
  }),
} satisfies Actions;
