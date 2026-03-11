import { courseJoinRequestSchema } from "@nojv/domain";
import { json } from "@sveltejs/kit";

import { withAuth } from "$lib/server/api-handler";
import { joinCourseRecord } from "$lib/server/data-access/courses";

export const POST = withAuth(async (event, actor) => {
  const slug = event.params.slug;
  const payload = courseJoinRequestSchema.parse({
    ...(await event.request.json()),
    courseSlug: slug
  });
  const result = await joinCourseRecord(actor, payload);

  return json(result);
});
