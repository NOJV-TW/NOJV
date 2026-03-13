import {
  assessmentScoreboardModeSchema,
  contestCreateSchema,
  courseAssessmentCreateSchema,
  courseAssessmentTypeSchema,
  contestScoringModeSchema,
  slugSchema
} from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";

import type { Actions, PageServerLoad } from "./$types";
import { canPublishAssessment, getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { createCourseAssessmentRecord } from "$lib/server/course/mutations";
import { createContestRecord } from "$lib/server/contest/mutations";
import { listCourseContests } from "$lib/server/contest/queries";

const assessmentFormSchema = z.object({
  closesAt: z.string().min(1),
  dueAt: z.string().min(1),
  ipLockEnabled: z.boolean().default(false),
  maxAttempts: z.coerce.number().int().min(1).max(999).nullish(),
  opensAt: z.string().min(1),
  pageLockEnabled: z.boolean().default(false),
  problemSlugsText: z.string().min(1),
  scoreboardMode: assessmentScoreboardModeSchema.optional(),
  slug: slugSchema,
  summary: z.string().min(8).max(2_000),
  title: z.string().min(3).max(120),
  type: courseAssessmentTypeSchema
});

const contestFormSchema = z.object({
  endsAt: z.string().min(1),
  frozenAt: z.string().optional(),
  problemSlugsText: z.string().min(1),
  scoringMode: contestScoringModeSchema.default("icpc"),
  slug: slugSchema,
  startsAt: z.string().min(1),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().min(8).max(4_000),
  title: z.string().min(3).max(120)
});

export const load: PageServerLoad = async ({ params, parent }) => {
  const { courseData } = await parent();
  const [form, contestForm, contests] = await Promise.all([
    superValidate(zod4(assessmentFormSchema)),
    superValidate(zod4(contestFormSchema)),
    listCourseContests(params.slug)
  ]);

  return {
    assessments: courseData.course.assessments,
    contests,
    contestForm,
    courseSlug: params.slug,
    problemSlugs: courseData.course.problemSlugs,
    form
  };
};

export const actions = {
  create: async (event) => {
    const actor = requireAuth(event);
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
  },

  createContest: async (event) => {
    const actor = requireAuth(event);
    const courseSlug = event.params.slug;
    const role = await getCoursePermissionRole(courseSlug, actor);

    if (!role || !canPublishAssessment(role)) {
      return fail(403, { error: "Only course staff can create contests." });
    }

    const form = await superValidate(event, zod4(contestFormSchema));
    if (!form.valid) return fail(400, { contestForm: form });

    try {
      const { problemSlugsText, startsAt, endsAt, frozenAt, ...rest } = form.data;
      const payload = contestCreateSchema.parse({
        ...rest,
        courseSlug,
        endsAt: new Date(endsAt).toISOString(),
        frozenAt: frozenAt ? new Date(frozenAt).toISOString() : undefined,
        problemSlugs: problemSlugsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        startsAt: new Date(startsAt).toISOString()
      });
      await createContestRecord(actor, payload);
      return message(form, `Contest "${payload.title}" created.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Contest creation failed.";
      return fail(400, { contestForm: form, error: msg });
    }
  }
} satisfies Actions;
