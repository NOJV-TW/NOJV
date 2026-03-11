import { courseCreateSchema } from "@nojv/domain";
import { json } from "@sveltejs/kit";

import { ForbiddenError } from "$lib/server/api-errors";
import { withAuth } from "$lib/server/api-handler";
import { canCreateCourse } from "$lib/server/authorization/permissions";
import { createCourseRecord } from "$lib/server/data-access/courses";
import { listCourseCards } from "$lib/server/read-model";

export const GET = withAuth(async () => {
  return json({
    courses: await listCourseCards()
  });
});

export const POST = withAuth(async (event, actor) => {
  if (!canCreateCourse(actor.platformRole)) {
    throw new ForbiddenError("Only teachers or admins can create courses.");
  }

  const payload = courseCreateSchema.parse(await event.request.json());
  const result = await createCourseRecord(actor, payload);

  return json(result, { status: 201 });
});
