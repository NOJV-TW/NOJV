import { problemTestcaseSetCreateSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { withAuthParams } from "@/lib/server/api-handler";
import { createProblemTestcaseSetRecord } from "@/lib/server/data-access/problems";

export const POST = withAuthParams<{ slug: string }>(async (request, actor, { slug }) => {
  const payload = problemTestcaseSetCreateSchema.parse(await request.json());
  const result = await createProblemTestcaseSetRecord(actor, slug, payload);

  return NextResponse.json(result, { status: 201 });
});
