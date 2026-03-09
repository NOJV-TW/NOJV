import { problemCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { ForbiddenError } from "@/lib/server/api-errors";
import { withAuth } from "@/lib/server/api-handler";
import { canCreateProblem } from "@/lib/server/authorization";
import { createProblemRecord } from "@/lib/server/poc-persistence";

export const POST = withAuth(async (request, actor) => {
  if (!canCreateProblem(actor.platformRole)) {
    throw new ForbiddenError("Only teachers or admins can author problems.");
  }

  const payload = problemCreateSchema.parse(await request.json());
  const result = await createProblemRecord(actor, payload);

  return NextResponse.json(result, { status: 201 });
});
