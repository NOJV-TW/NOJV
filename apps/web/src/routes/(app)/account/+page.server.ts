import { fail, redirect } from "@sveltejs/kit";

import { isReservedHandle } from "$lib/school";
import { readHandleFromAuthUser, readStringValue } from "$lib/server/auth";
import { processSchoolVerification } from "$lib/server/shared/school-verification";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/");
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

export const actions = {
  sendVerification: async ({ locals, request }) => {
    const user = locals.user;
    if (!user) {
      return fail(401, { error: "Unauthorized" });
    }

    const formData = await request.formData();
    const email = (formData.get("email") as string | null)?.trim() ?? "";
    const result = await processSchoolVerification(user.id, email);

    if ("error" in result) {
      return fail(result.status, { error: result.error });
    }

    return { success: true };
  }
} satisfies Actions;
