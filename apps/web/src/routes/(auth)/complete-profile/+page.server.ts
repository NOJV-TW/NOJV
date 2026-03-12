import { fail, redirect } from "@sveltejs/kit";

import { hasCompletedHandle } from "$lib/server/auth";
import { processSchoolVerification } from "$lib/server/shared/school-verification";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  const user = locals.user;

  if (!user) {
    redirect(302, "/");
  }

  const userRecord = user as Record<string, unknown>;

  if (hasCompletedHandle(userRecord)) {
    redirect(302, "/");
  }

  return {
    email: user.email,
    name: user.name || user.email
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
