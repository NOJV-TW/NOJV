import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { readHandleFromAuthUser, readStringValue } from "$lib/auth-onboarding";
import { isReservedHandle } from "$lib/school-verification";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(302, `/${params.locale}`);
  }

  const user = locals.user as Record<string, unknown>;
  const rawHandle = readHandleFromAuthUser(user);
  const handle = rawHandle ?? "\u2014";
  const platformRole = readStringValue(user.platformRole) ?? "student";
  const isSchoolVerified = rawHandle !== null && isReservedHandle(rawHandle);

  return {
    email: locals.user.email,
    handle,
    isSchoolVerified,
    name: locals.user.name,
    platformRole
  };
};
