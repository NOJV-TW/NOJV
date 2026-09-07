import { activityProblemsSchema, activityTotalPointsSchema } from "@nojv/core";
import { z } from "zod";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import {
  contestScoringModeSchema,
  examCreateSchema,
  IP_WHITELIST_MAX_TEXT_LENGTH,
  ipViolationModeSchema,
  languageSchema,
  latePenaltyRuleSchema,
  refineLateSubmissionWindow,
  parseIpWhitelistText,
  scoreboardModeSchema,
  type ExamCreate,
  type ExamPublishStatus,
} from "@nojv/core";
import { canManageCourse, examDomain, courseDomain } from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent, RequestEvent } from "./$types";
import { getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { classifyRequestError } from "$lib/server/shared/handle-action-error";
import { withAction } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import type { FormMessage } from "$lib/types/form-message";

const { createExamRecord } = examDomain;
const { listCourseProblemPickerGroups } = courseDomain;

const examFormSchema = z
  .object({
    courseId: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().max(4_000).default(""),
    problems: activityProblemsSchema.default([]),
    totalPoints: activityTotalPointsSchema.default(100),
    startsAt: z.string().trim().min(1),
    endsAt: z.string().trim().default(""),
    dueAt: z.string().trim().min(1),
    allowLateSubmissions: z.boolean().default(false),
    latePenalty: latePenaltyRuleSchema.nullable().default(null),
    allowedLanguages: z.array(languageSchema).max(8).default([]),
    pageLockEnabled: z.boolean().default(false),
    ipBindingEnabled: z.boolean().default(false),
    ipViolationMode: ipViolationModeSchema.default("block"),
    ipWhitelistEnabled: z.boolean().default(false),
    ipWhitelistText: z.string().max(IP_WHITELIST_MAX_TEXT_LENGTH).default(""),
    scoringMode: contestScoringModeSchema.default("point_sum"),
    scoreboardMode: scoreboardModeSchema.default("hidden"),
    submitCooldownSec: z.coerce.number().int().min(0).max(3_600).default(0),
  })
  .superRefine((value, ctx) => {
    const startsAt = new Date(value.startsAt);
    refineLateSubmissionWindow(value, value.endsAt, ctx, "endsAt");
    const dueAt = new Date(value.dueAt);

    if (Number.isNaN(startsAt.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid startsAt", path: ["startsAt"] });
      return;
    }
    if (dueAt <= startsAt) {
      ctx.addIssue({
        code: "custom",
        message: "dueAt must be later than startsAt",
        path: ["dueAt"],
      });
    }
    if (value.allowLateSubmissions && value.latePenalty && value.scoringMode !== "point_sum") {
      ctx.addIssue({
        code: "custom",
        message: "Late penalties require point-sum scoring",
        path: ["latePenalty"],
      });
    }
  });

type ExamFormData = z.infer<typeof examFormSchema>;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { course, isManager } = parent;
  if (!isManager) {
    redirect(302, `/courses/${course.id}/exams`);
  }

  const actor = requireAuth(event);

  const [form, candidateProblems] = await Promise.all([
    superValidate<ExamFormData>(
      {
        courseId: course.id,
        title: "",
        summary: "",
        problems: [],
        totalPoints: 100,
        startsAt: "",
        endsAt: "",
        dueAt: "",
        allowLateSubmissions: false,
        latePenalty: null,
        allowedLanguages: [],
        pageLockEnabled: false,
        ipBindingEnabled: false,
        ipViolationMode: "block",
        ipWhitelistEnabled: false,
        ipWhitelistText: "",
        scoringMode: "point_sum",
        scoreboardMode: "hidden",
        submitCooldownSec: 0,
      },
      zod4(examFormSchema),
      { errors: false },
    ),
    listCourseProblemPickerGroups(actor, course.id),
  ]);

  return { form, candidateProblems };
});

function toIsoOrEmpty(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function buildCreatePayload(form: ExamFormData, status: ExamPublishStatus): ExamCreate {
  return examCreateSchema.parse({
    allowedLanguages: form.allowedLanguages,
    courseId: form.courseId,
    endsAt: toIsoOrEmpty(form.allowLateSubmissions ? form.endsAt : form.dueAt),
    dueAt: toIsoOrEmpty(form.dueAt),
    adjustmentRules: form.allowLateSubmissions && form.latePenalty ? [form.latePenalty] : [],
    ipBindingEnabled: form.ipBindingEnabled,
    ipViolationMode: form.ipViolationMode,
    ipWhitelist: form.ipWhitelistEnabled ? parseIpWhitelistText(form.ipWhitelistText) : [],
    ipWhitelistEnabled: form.ipWhitelistEnabled,
    pageLockEnabled: form.pageLockEnabled,
    problems: form.problems,
    totalPoints: form.totalPoints,
    scoreboardMode: form.scoreboardMode,
    scoringMode: form.scoringMode,
    startsAt: toIsoOrEmpty(form.startsAt),
    status,
    submitCooldownSec: form.submitCooldownSec,
    summary: form.summary ? form.summary : undefined,
    title: form.title,
  });
}

function runCreateAction(status: ExamPublishStatus) {
  return withAction(async (event: RequestEvent) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;
    const form = await superValidate<ExamFormData, FormMessage>(event, zod4(examFormSchema));

    let examId: string;
    try {
      const permissionRole = await getCoursePermissionRole(courseId, actor);
      if (!canManageCourse(permissionRole)) {
        return message<FormMessage>(
          form,
          { kind: "error", text: "Forbidden" },
          { status: 403 },
        );
      }
      if (!form.valid) return fail(400, { form });

      if (form.data.courseId !== courseId) {
        return message<FormMessage>(
          form,
          { kind: "error", text: "Course mismatch." },
          { status: 400 },
        );
      }

      const payload = buildCreatePayload(form.data, status);
      const created = await createExamRecord(actor, payload);
      examId = created.id;
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    redirect(303, `/exams/${examId}`);
  });
}

export const actions = {
  saveDraft: runCreateAction("draft"),
  publish: runCreateAction("published"),
} satisfies Actions;
