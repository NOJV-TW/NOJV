import { courseJoinRequestSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { courseDomain } from "@nojv/domain";

const { joinCourseRecord } = courseDomain;

const joinFormSchema = courseJoinRequestSchema.omit({ courseSlug: true });

export const load: PageServerLoad = async ({ params, parent, url }) => {
  const { slug, token } = params;
  const kindParam = url.searchParams.get("kind");
  const { courseData } = await parent();

  // Join links now carry the new token-kind taxonomy: `link` (any
  // shareable URL / QR code) or `code` (a short typed code). Anything
  // else is treated as a manual / unknown channel.
  const joinTokenKind: "link" | "code" | null =
    kindParam === "link" || kindParam === "code" ? kindParam : null;

  const form = await superValidate(
    joinTokenKind ? { joinTokenKind, joinToken: token } : { joinToken: token },
    zod4(joinFormSchema)
  );

  return {
    courseSlug: slug,
    courseTitle: courseData.course.title,
    form,
    joinTokenKind,
    joinToken: token
  };
};

export const actions = {
  join: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

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
