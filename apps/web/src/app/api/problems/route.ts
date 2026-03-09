import { problemCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { withAuth } from "@/lib/server/api-handler";
import { createProblemRecord } from "@/lib/server/poc-persistence";

export const POST = withAuth(async (request, actor) => {
  const payload = problemCreateSchema.parse(await request.json());
  const result = await createProblemRecord(actor, payload);

  return NextResponse.json(result, { status: 201 });
});
