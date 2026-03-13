import { fail, redirect } from "@sveltejs/kit";

import { isReservedUsername } from "$lib/school";
import { processSchoolVerification } from "$lib/server/shared/school-verification";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/");
  }

  const sessionUser = locals.sessionUser;
  const username = sessionUser?.username ?? null;
  const platformRole = sessionUser?.platformRole ?? "student";
  const isSchoolVerified = username !== null && isReservedUsername(username);

  return {
    email: locals.user.email,
    username: username ?? "\u2014",
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
    const email = ((formData.get("email") as string | null) ?? "").trim();
    const result = await processSchoolVerification(user.id, email);

    if ("error" in result) {
      return fail(result.status, { error: result.error });
    }

    return { success: true };
  }
} satisfies Actions;
