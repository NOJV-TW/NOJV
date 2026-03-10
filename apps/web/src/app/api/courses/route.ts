import { courseCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { ForbiddenError } from "@/lib/server/api-errors";
import { withAuth } from "@/lib/server/api-handler";
import { canCreateCourse } from "@/lib/server/authorization";
import { createCourseRecord } from "@/lib/server/data-access/courses";
import { listCourseCards } from "@/lib/server/read-model";

export const GET = withAuth(async () => {
  return NextResponse.json({
    courses: await listCourseCards()
  });
});

export const POST = withAuth(async (request, actor) => {
  if (!canCreateCourse(actor.platformRole)) {
    throw new ForbiddenError("Only teachers or admins can create courses.");
  }

  const payload = courseCreateSchema.parse(await request.json());
  const result = await createCourseRecord(actor, payload);

  return NextResponse.json(result, { status: 201 });
});
