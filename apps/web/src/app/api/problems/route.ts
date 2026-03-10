import { problemCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { withAuth } from "@/lib/server/api-handler";
import { ForbiddenError } from "@/lib/server/api-errors";
import { createProblemRecord } from "@/lib/server/data-access/problems";

export const POST = withAuth(async (request, actor) => {
  if (actor.platformRole === "student") {
    throw new ForbiddenError("Only teachers and admins can create problems.");
  }

  const payload = problemCreateSchema.parse(await request.json());
  const result = await createProblemRecord(actor, payload);

  return NextResponse.json(result, { status: 201 });
});
