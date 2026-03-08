import { courseProblemAttachSchema } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getActorContext } from "@/lib/server/actor-context";
import { canManageCourseMembership } from "@/lib/server/course-authorization";
import {
  attachProblemToCourseRecord,
  getCoursePermissionRole
} from "@/lib/server/poc-persistence";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ slug: string }>;
  }
) {
  try {
    const actor = await getActorContext(request);

    if (!actor) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }

    const { slug } = await context.params;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canManageCourseMembership(role)) {
      return NextResponse.json(
        {
          message: "Only course staff can attach problems to a course."
        },
        { status: 403 }
      );
    }

    const payload = courseProblemAttachSchema.parse({
      ...(await request.json()),
      courseSlug: slug
    });
    const result = await attachProblemToCourseRecord(actor, payload);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid course problem payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Course problem attach failed.";
    const status = message.includes("author or an admin") ? 403 : 500;

    return NextResponse.json({ message }, { status });
  }
}
