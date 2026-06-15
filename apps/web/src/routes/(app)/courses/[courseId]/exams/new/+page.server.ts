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
  parseIpWhitelistText,
  scoreboardModeSchema,
  type ExamCreate,
  type ExamPublishStatus,
} from "@nojv/core";
import { canManageCourse, examDomain, problemDomain } from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent, RequestEvent } from "./$types";
import { getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import type { FormMessage } from "$lib/types/form-message";

const { createExamRecord } = examDomain;
const { listEditableProblems } = problemDomain;

const examFormSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().max(120).default(""),
  summary: z.string().trim().max(4_000).default(""),
  problemIds: z.array(z.string().min(1)).default([]),
  startsAt: z.string().default(""),
  endsAt: z.string().default(""),
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  pageLockEnabled: z.boolean().default(false),
  ipBindingEnabled: z.boolean().default(false),
  ipViolationMode: ipViolationModeSchema.default("block"),
  ipWhitelistEnabled: z.boolean().default(false),
  ipWhitelistText: z.string().max(IP_WHITELIST_MAX_TEXT_LENGTH).default(""),
  scoringMode: contestScoringModeSchema.default("point_sum"),
  scoreboardMode: scoreboardModeSchema.default("hidden"),
  submitCooldownSec: z.coerce.number().int().min(0).max(3_600).default(0),
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
        problemIds: [],
        startsAt: "",
        endsAt: "",
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
    ),
    listEditableProblems(actor.userId),
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
    endsAt: toIsoOrEmpty(form.endsAt),
    ipBindingEnabled: form.ipBindingEnabled,
    ipViolationMode: form.ipViolationMode,
    ipWhitelist: form.ipWhitelistEnabled ? parseIpWhitelistText(form.ipWhitelistText) : [],
    ipWhitelistEnabled: form.ipWhitelistEnabled,
    pageLockEnabled: form.pageLockEnabled,
    problemIds: form.problemIds,
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
  return withRateLimit(async (event: RequestEvent) => {
    const actor = requireAuth(event);
    const courseId = event.params.courseId;
    const permissionRole = await getCoursePermissionRole(courseId, actor);
    if (!canManageCourse(permissionRole)) {
      return fail(403, { error: "Forbidden" });
    }

    const form = await superValidate<ExamFormData, FormMessage>(event, zod4(examFormSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    if (form.data.courseId !== courseId) {
      return message<FormMessage>(
        form,
        { kind: "error", text: "Course mismatch." },
        { status: 400 },
      );
    }

    let examId: string;
    try {
      const payload = buildCreatePayload(form.data, status);
      const created = await createExamRecord(actor, payload);
      examId = created.id;
    } catch (err) {
      const classified = classifyError(err);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: 400 },
      );
    }

    redirect(303, `/exams/${examId}`);
  });
}

export const actions = {
  saveDraft: runCreateAction("draft"),
  publish: runCreateAction("published"),
} satisfies Actions;
