import { fail } from "@sveltejs/kit";
import { userDomain } from "@nojv/domain";

import { m } from "$lib/paraglide/messages.js";

import type { Actions, PageServerLoad } from "./$types";

const { peekSchoolVerification, processSchoolVerification } = userDomain;

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get("token");

  if (!token) {
    return { status: "error" as const, detail: m.auth_missingVerifyToken() };
  }

  const result = await peekSchoolVerification(token);
  if (result.status === "error") {
    return { status: "error" as const, detail: result.detail };
  }

  return { status: "confirm" as const, username: result.username, token };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const token = (await request.formData()).get("token");
    if (typeof token !== "string" || !token) {
      return fail(400, { status: "error" as const, detail: m.auth_missingVerifyToken() });
    }
    return processSchoolVerification(token);
  },
};
