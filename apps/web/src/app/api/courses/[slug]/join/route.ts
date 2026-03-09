import { courseJoinRequestSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { withAuthParams } from "@/lib/server/api-handler";
import { joinCourseRecord } from "@/lib/server/poc-persistence";

export const POST = withAuthParams<{ slug: string }>(async (request, actor, { slug }) => {
  const payload = courseJoinRequestSchema.parse({
    ...(await request.json()),
    courseSlug: slug
  });
  const result = await joinCourseRecord(actor, payload);

  return NextResponse.json(result);
});
