import { userDomain } from "@nojv/domain";

import { m } from "$lib/paraglide/messages.js";

import type { PageServerLoad } from "./$types";

const { processSchoolVerification } = userDomain;

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get("token");

  if (!token) {
    return { status: "error" as const, detail: m.auth_missingVerifyToken() };
  }

  return processSchoolVerification(token);
};
