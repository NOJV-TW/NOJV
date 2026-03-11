import type { PageServerLoad } from "./$types";
import type { PlatformRole } from "@nojv/domain";
import { listCourseCards, listUserCourseCards } from "$lib/server/read-model";

function canCreateCourse(platformRole: PlatformRole) {
  return platformRole === "admin" || platformRole === "teacher";
}

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id ?? null;
  const platformRole =
    ((locals.user as Record<string, unknown> | undefined)?.platformRole as
      | PlatformRole
      | undefined) ?? "student";
  const isStaff = canCreateCourse(platformRole);

  const courses = isStaff
    ? await listCourseCards()
    : userId
      ? await listUserCourseCards(userId)
      : [];

  return { courses };
};
