import { fail, redirect } from "@sveltejs/kit";

import { isReservedHandle } from "$lib/school";
import { processSchoolVerification } from "$lib/server/shared/school-verification";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) {
    redirect(302, "/");
  }

  const sessionUser = locals.sessionUser;
  const handle = sessionUser?.handle ?? null;
  const platformRole = sessionUser?.platformRole ?? "student";
  const isSchoolVerified = handle !== null && isReservedHandle(handle);

  return {
    email: locals.user.email,
    handle: handle ?? "\u2014",
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
    const email = String(formData.get("email") ?? "").trim();
    const result = await processSchoolVerification(user.id, email);

    if ("error" in result) {
      return fail(result.status, { error: result.error });
    }

    return { success: true };
  }
} satisfies Actions;
