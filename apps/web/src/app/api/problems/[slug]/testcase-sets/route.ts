import { problemTestcaseSetCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { ForbiddenError } from "@/lib/server/api-errors";
import { withAuthParams } from "@/lib/server/api-handler";
import { canCreateProblem } from "@/lib/server/authorization";
import { createProblemTestcaseSetRecord } from "@/lib/server/poc-persistence";

export const POST = withAuthParams<{ slug: string }>(async (request, actor, { slug }) => {
  if (!canCreateProblem(actor.platformRole)) {
    throw new ForbiddenError("Only teachers or admins can manage problem testcases.");
  }

  const payload = problemTestcaseSetCreateSchema.parse(await request.json());
  const result = await createProblemTestcaseSetRecord(actor, slug, payload);

  return NextResponse.json(result, { status: 201 });
});
