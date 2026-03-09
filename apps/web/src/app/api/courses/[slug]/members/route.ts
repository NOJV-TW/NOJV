import { manualCourseEnrollmentSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { ForbiddenError } from "@/lib/server/api-errors";
import { withAuthParams } from "@/lib/server/api-handler";
import { canManageCourseMembership, getCoursePermissionRole } from "@/lib/server/authorization";
import { manuallyEnrollCourseMember } from "@/lib/server/poc-persistence";

export const POST = withAuthParams<{ slug: string }>(async (request, actor, { slug }) => {
  const role = await getCoursePermissionRole(slug, actor);

  if (!role || !canManageCourseMembership(role)) {
    throw new ForbiddenError("Only course staff can manage members.");
  }

  const payload = manualCourseEnrollmentSchema.parse({
    ...(await request.json()),
    courseSlug: slug
  });
  const result = await manuallyEnrollCourseMember(actor, payload);

  return NextResponse.json(result, { status: 201 });
});
