import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { hasCompletedHandle } from "$lib/auth-onboarding";

export const load: PageServerLoad = async ({ params, locals }) => {
  const user = locals.user;

  if (!user) {
    redirect(302, `/${params.locale}`);
  }

  const userRecord = user as Record<string, unknown>;

  if (hasCompletedHandle(userRecord)) {
    redirect(302, `/${params.locale}`);
  }

  return {
    email: user.email,
    locale: params.locale,
    name: user.name || user.email
  };
};
