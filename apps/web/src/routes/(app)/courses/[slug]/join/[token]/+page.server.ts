import { courseJoinRequestSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { joinCourseRecord } from "$lib/server/course/mutations";

const joinFormSchema = courseJoinRequestSchema.omit({ courseSlug: true });

export const load: PageServerLoad = async ({ params, parent, url }) => {
  const { slug, token } = params;
  const method = url.searchParams.get("method");
  const { courseData } = await parent();

  const joinMethod: "join_code" | "qr_code" | "manual_invite" | null =
    method === "join_code" || method === "qr_code" || method === "manual_invite"
      ? method
      : null;

  const form = await superValidate(
    joinMethod ? { joinMethod, joinToken: token } : { joinToken: token },
    zod4(joinFormSchema)
  );

  return {
    courseSlug: slug,
    courseTitle: courseData.course.title,
    form,
    joinMethod,
    joinToken: token
  };
};

export const actions = {
  join: async (event) => {
    const actor = requireAuth(event);
    const slug = event.params.slug;

    const form = await superValidate(event, zod4(joinFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      const payload = courseJoinRequestSchema.parse({
        ...form.data,
        courseSlug: slug
      });
      await joinCourseRecord(actor, payload);
      return message(form, "Joined course.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join course.";
      return fail(400, { form, error: msg });
    }
  }
} satisfies Actions;
