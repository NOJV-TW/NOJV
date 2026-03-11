import { courseAssessmentCreateSchema } from "@nojv/domain";
import { json } from "@sveltejs/kit";

import { ForbiddenError } from "$lib/server/api-errors";
import { withAuth } from "$lib/server/api-handler";
import { canPublishAssessment } from "$lib/server/authorization/permissions";
import { getCoursePermissionRole } from "$lib/server/authorization/roles";
import { createCourseAssessmentRecord } from "$lib/server/data-access/courses";

export const POST = withAuth(async (event, actor) => {
  const slug = event.params.slug;
  const role = await getCoursePermissionRole(slug, actor);

  if (!role || !canPublishAssessment(role)) {
    throw new ForbiddenError("Only course staff can publish assignments or exams.");
  }

  const payload = courseAssessmentCreateSchema.parse({
    ...(await event.request.json()),
    courseSlug: slug
  });
  const result = await createCourseAssessmentRecord(actor, payload);

  return json(result, { status: 201 });
});
