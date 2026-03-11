import { manualCourseEnrollmentSchema } from "@nojv/domain";
import { json } from "@sveltejs/kit";

import { ForbiddenError } from "$lib/server/api-errors";
import { withAuth } from "$lib/server/api-handler";
import { canManageCourseMembership } from "$lib/server/authorization/permissions";
import { getCoursePermissionRole } from "$lib/server/authorization/roles";
import { manuallyEnrollCourseMember } from "$lib/server/data-access/courses";

export const POST = withAuth(async (event, actor) => {
  const slug = event.params.slug;
  const role = await getCoursePermissionRole(slug, actor);

  if (!role || !canManageCourseMembership(role)) {
    throw new ForbiddenError("Only course staff can manage members.");
  }

  const payload = manualCourseEnrollmentSchema.parse({
    ...(await event.request.json()),
    courseSlug: slug
  });
  const result = await manuallyEnrollCourseMember(actor, payload);

  return json(result, { status: 201 });
});
