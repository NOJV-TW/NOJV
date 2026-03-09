import { courseAssessmentCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { ForbiddenError } from "@/lib/server/api-errors";
import { withAuthParams } from "@/lib/server/api-handler";
import { canPublishAssessment, getCoursePermissionRole } from "@/lib/server/authorization";
import { createCourseAssessmentRecord } from "@/lib/server/poc-persistence";

export const POST = withAuthParams<{ slug: string }>(async (request, actor, { slug }) => {
  const role = await getCoursePermissionRole(slug, actor);

  if (!role || !canPublishAssessment(role)) {
    throw new ForbiddenError("Only course staff can publish assignments or exams.");
  }

  const payload = courseAssessmentCreateSchema.parse({
    ...(await request.json()),
    courseSlug: slug
  });
  const result = await createCourseAssessmentRecord(actor, payload);

  return NextResponse.json(result, { status: 201 });
});
