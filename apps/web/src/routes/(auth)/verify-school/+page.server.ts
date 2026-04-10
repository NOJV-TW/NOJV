import { verificationDomain } from "@nojv/domain";

import type { PageServerLoad } from "./$types";

const { processSchoolVerification } = verificationDomain;

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get("token");

  if (!token) {
    return { status: "error" as const, detail: "缺少驗證 token" };
  }

  // The token itself now carries the username — no parseData callback
  // is needed because SchoolVerificationToken rows store username
  // directly instead of encoding it into the opaque better-auth
  // verification record.
  return processSchoolVerification(token);
};
