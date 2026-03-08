import { courseJoinRequestSchema } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getActorContext } from "@/lib/server/actor-context";
import { joinCourseRecord } from "@/lib/server/poc-persistence";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ slug: string }>;
  }
) {
  try {
    const actor = getActorContext(request);
    const { slug } = await context.params;
    const payload = courseJoinRequestSchema.parse({
      ...(await request.json()),
      courseSlug: slug
    });
    const result = await joinCourseRecord(actor, payload);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid course join payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Course join failed.";
    const status =
      message.includes("invalid") ||
      message.includes("expired") ||
      message.includes("maximum usage")
        ? 403
        : 500;

    return NextResponse.json({ message }, { status });
  }
}
