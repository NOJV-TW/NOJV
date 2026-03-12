import { courseAssessmentCreateSchema } from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";

import type { Actions, PageServerLoad } from "./$types";
import { canPublishAssessment, getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { createCourseAssessmentRecord } from "$lib/server/course/mutations";

const assessmentFormSchema = z.object({
  closesAt: z.string().min(1),
  dueAt: z.string().min(1),
  ipLockEnabled: z.boolean().default(false),
  maxAttempts: z.coerce.number().int().min(1).max(999).nullish(),
  opensAt: z.string().min(1),
  pageLockEnabled: z.boolean().default(false),
  problemSlugsText: z.string().min(1),
  scoreboardMode: z.enum(["hidden", "live", "frozen"]).optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3),
  summary: z.string().min(8).max(2_000),
  title: z.string().min(3).max(120),
  type: z.enum(["assignment", "exam"])
});

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();
  const form = await superValidate(zod4(assessmentFormSchema));

  return {
    assessments: courseData.course.assessments,
    courseSlug: params.slug,
    problemSlugs: courseData.course.problemSlugs,
    form
  };
};

export const actions = {
  create: async (event) => {
    const actor = await requireAuth(event);
    const slug = event.params.slug;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canPublishAssessment(role)) {
      return fail(403, { error: "Only course staff can publish assignments or exams." });
    }

    const form = await superValidate(event, zod4(assessmentFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      const { problemSlugsText, opensAt, dueAt, closesAt, ...rest } = form.data;
      const payload = courseAssessmentCreateSchema.parse({
        ...rest,
        closesAt: new Date(closesAt).toISOString(),
        courseSlug: slug,
        dueAt: new Date(dueAt).toISOString(),
        opensAt: new Date(opensAt).toISOString(),
        problemSlugs: problemSlugsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      });
      await createCourseAssessmentRecord(actor, payload);
      return message(form, `Published ${payload.title}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Assessment publish failed.";
      return fail(400, { form, error: msg });
    }
  }
} satisfies Actions;
