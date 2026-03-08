import { courseCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getActorContext } from "@/lib/server/actor-context";
import { canCreateCourse } from "@/lib/server/course-authorization";
import { createCourseRecord } from "@/lib/server/poc-persistence";
import { listCourseCards } from "@/lib/server/read-model";

export async function GET() {
  return NextResponse.json({
    courses: await listCourseCards()
  });
}

export async function POST(request: Request) {
  try {
    const actor = await getActorContext(request);

    if (!canCreateCourse(actor.platformRole)) {
      return NextResponse.json(
        {
          message: "Only teachers or admins can create courses."
        },
        { status: 403 }
      );
    }

    const payload = courseCreateSchema.parse(await request.json());
    const result = await createCourseRecord(actor, payload);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid course payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Course creation failed.";
    const status = message.includes("already exists") ? 409 : 500;

    return NextResponse.json({ message }, { status });
  }
}
