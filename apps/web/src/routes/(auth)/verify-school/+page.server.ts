import { userDomain } from "@nojv/domain";

import { m } from "$lib/paraglide/messages.js";

import type { PageServerLoad } from "./$types";

const { processSchoolVerification } = userDomain;

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get("token");

  if (!token) {
    return { status: "error" as const, detail: m.auth_missingVerifyToken() };
  }

  // The token itself now carries the username — no parseData callback
  // is needed because SchoolVerificationToken rows store username
  // directly instead of encoding it into the opaque better-auth
  // verification record.
  return processSchoolVerification(token);
};
