import { courseProblemAttachSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { ForbiddenError } from "@/lib/server/api-errors";
import { withAuthParams } from "@/lib/server/api-handler";
import { canManageCourseMembership, getCoursePermissionRole } from "@/lib/server/authorization";
import { attachProblemToCourseRecord } from "@/lib/server/data-access/courses";

export const POST = withAuthParams<{ slug: string }>(async (request, actor, { slug }) => {
  const role = await getCoursePermissionRole(slug, actor);

  if (!role || !canManageCourseMembership(role)) {
    throw new ForbiddenError("Only course staff can attach problems to a course.");
  }

  const payload = courseProblemAttachSchema.parse({
    ...(await request.json()),
    courseSlug: slug
  });
  const result = await attachProblemToCourseRecord(actor, payload);

  return NextResponse.json(result, { status: 201 });
});
