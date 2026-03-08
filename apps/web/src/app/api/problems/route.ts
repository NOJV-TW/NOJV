import { problemCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getActorContext } from "@/lib/server/actor-context";
import { canCreateProblem } from "@/lib/server/course-authorization";
import { createProblemRecord } from "@/lib/server/poc-persistence";

export async function POST(request: Request) {
  try {
    const actor = getActorContext(request);

    if (!canCreateProblem(actor.platformRole)) {
      return NextResponse.json(
        {
          message: "Only teachers or admins can author problems."
        },
        { status: 403 }
      );
    }

    const payload = problemCreateSchema.parse(await request.json());
    const result = await createProblemRecord(actor, payload);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid problem payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Problem creation failed.";
    const status = message.includes("already exists") ? 409 : 500;

    return NextResponse.json({ message }, { status });
  }
}
