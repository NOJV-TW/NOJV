import {
  assessmentScoreboardModeSchema,
  contestCreateSchema,
  courseAssessmentCreateSchema,
  ipLockFormFields,
  languageSchema,
  slugSchema
} from "@nojv/core";
import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";

import type { Actions, PageServerLoad } from "./$types";
import { canPublishAssessment, getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { contestDomain, courseDomain } from "@nojv/domain";

const { createCourseAssessmentRecord } = courseDomain;
const { createContestRecord, listCourseContests, contestFormSchema } = contestDomain;

const assessmentFormSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  closesAt: z.string().min(1),
  dueAt: z.string().min(1),
  ...ipLockFormFields,
  maxAttempts: z.coerce.number().int().min(1).max(999).nullish(),
  opensAt: z.string().min(1),
  pageLockEnabled: z.boolean().default(false),
  problemIdsText: z.string().min(1),
  scoreboardMode: assessmentScoreboardModeSchema.optional(),
  slug: slugSchema,
  summary: z.string().min(8).max(2_000),
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
    problemIds: courseData.course.problemIds,
    form
  };
};

export const actions = {
  create: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const slug = event.params.slug;
    const role = await getCoursePermissionRole(slug, actor);

    if (!role || !canPublishAssessment(role)) {
      return fail(403, { error: "Only course staff can publish assignments." });
    }

    const form = await superValidate(event, zod4(assessmentFormSchema));
    if (!form.valid) return fail(400, { form });

    try {
      const { problemIdsText, ipWhitelistText, opensAt, dueAt, closesAt, ...rest } = form.data;
      const payload = courseAssessmentCreateSchema.parse({
        ...rest,
        ipWhitelist: ipWhitelistText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        closesAt: new Date(closesAt).toISOString(),
        courseSlug: slug,
        dueAt: new Date(dueAt).toISOString(),
        opensAt: new Date(opensAt).toISOString(),
        problemIds: problemIdsText
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
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const courseSlug = event.params.slug;
    const role = await getCoursePermissionRole(courseSlug, actor);

    if (!role || !canPublishAssessment(role)) {
      return fail(403, { error: "Only course staff can create contests." });
    }

    const form = await superValidate(event, zod4(contestFormSchema));
    if (!form.valid) return fail(400, { contestForm: form });

    try {
      const { problemIdsText, ipWhitelistText, startsAt, endsAt, frozenAt, ...rest } =
        form.data;
      const payload = contestCreateSchema.parse({
        ...rest,
        courseSlug,
        ipWhitelist: ipWhitelistText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        endsAt: new Date(endsAt).toISOString(),
        frozenAt: frozenAt ? new Date(frozenAt).toISOString() : undefined,
        problemIds: problemIdsText
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
