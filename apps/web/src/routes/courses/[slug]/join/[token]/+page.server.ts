import { courseJoinRequestSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { joinCourseRecord } from "$lib/server/db";

export const load: PageServerLoad = async ({ params, parent, url }) => {
  const { slug, token } = params;
  const method = url.searchParams.get("method");
  const { courseData } = await parent();

  const joinMethod =
    method === "join_code" || method === "qr_code" || method === "manual_invite"
      ? method
      : null;

  return {
    courseSlug: slug,
    courseTitle: courseData.course.title,
    joinMethod,
    joinToken: token
  };
};

export const actions = {
  join: async (event) => {
    const actor = await requireAuth(event);
    const slug = event.params.slug;

    try {
      const formData = await event.request.formData();
      const data = JSON.parse(formData.get("data") as string);
      const payload = courseJoinRequestSchema.parse({
        ...data,
        courseSlug: slug
      });
      const result = await joinCourseRecord(actor, payload);
      return { success: true, membership: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join course.";
      return fail(400, { error: message });
    }
  }
} satisfies Actions;
