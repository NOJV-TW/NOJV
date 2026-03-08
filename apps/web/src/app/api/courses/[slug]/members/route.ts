import { manualCourseEnrollmentSchema } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getActorContext } from "@/lib/server/actor-context";
import { canManageCourseMembership } from "@/lib/server/course-authorization";
import {
  getCoursePermissionRole,
  manuallyEnrollCourseMember
} from "@/lib/server/poc-persistence";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ slug: string }>;
  }
) {
  try {
    const actor = await getActorContext(request);
    const { slug } = await context.params;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canManageCourseMembership(role)) {
      return NextResponse.json(
        {
          message: "Only course staff can manage members."
        },
        { status: 403 }
      );
    }

    const payload = manualCourseEnrollmentSchema.parse({
      ...(await request.json()),
      courseSlug: slug
    });
    const result = await manuallyEnrollCourseMember(actor, payload);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid member enrollment payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Manual enrollment failed.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
