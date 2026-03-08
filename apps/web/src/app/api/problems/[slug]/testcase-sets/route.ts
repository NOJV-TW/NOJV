import { problemTestcaseSetCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getActorContext } from "@/lib/server/actor-context";
import { canCreateProblem } from "@/lib/server/course-authorization";
import { createProblemTestcaseSetRecord } from "@/lib/server/poc-persistence";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ slug: string }>;
  }
) {
  try {
    const actor = await getActorContext(request);

    if (!canCreateProblem(actor.platformRole)) {
      return NextResponse.json(
        {
          message: "Only teachers or admins can manage problem testcases."
        },
        { status: 403 }
      );
    }

    const { slug } = await context.params;
    const payload = problemTestcaseSetCreateSchema.parse(await request.json());
    const result = await createProblemTestcaseSetRecord(actor, slug, payload);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid testcase set payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Testcase set creation failed.";
    const status = message.includes("Unique constraint failed")
      ? 409
      : message.includes("not found")
        ? 404
        : message.includes("author") || message.includes("admin")
          ? 403
          : 500;

    return NextResponse.json({ message }, { status });
  }
}
