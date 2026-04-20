import { z } from "zod";
import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import {
  contestScoringModeSchema,
  examCreateSchema,
  ipViolationModeSchema,
  languageSchema,
  scoreboardModeSchema,
  type ExamCreate,
  type ExamPublishStatus,
} from "@nojv/core";
import { canManageCourse, examDomain, problemDomain } from "@nojv/domain";

import type { Actions, PageServerLoad, PageServerLoadEvent, RequestEvent } from "./$types";
import { getCoursePermissionRole, requireAuth } from "$lib/server/auth";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import type { FormMessage } from "$lib/types/form-message";

const { createExamRecord } = examDomain;
const { listEditableProblems } = problemDomain;

// `datetime-local` binds to lax `YYYY-MM-DDTHH:mm` strings; `toIsoOrEmpty` converts on submit.
const examFormSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().max(120).default(""),
  summary: z.string().trim().max(4_000).default(""),
  problemIds: z.array(z.string().min(1)).default([]),
  startsAt: z.string().default(""),
  endsAt: z.string().default(""),
  frozenAt: z.string().default(""),
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  pageLockEnabled: z.boolean().default(false),
  ipBindingEnabled: z.boolean().default(false),
  ipViolationMode: ipViolationModeSchema.default("block"),
  ipWhitelistEnabled: z.boolean().default(false),
  ipWhitelistText: z.string().max(50_000).default(""),
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
        frozenAt: "",
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

function parseWhitelist(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

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
    frozenAt: form.frozenAt ? toIsoOrEmpty(form.frozenAt) || undefined : undefined,
    ipBindingEnabled: form.ipBindingEnabled,
    ipViolationMode: form.ipViolationMode,
    ipWhitelist: form.ipWhitelistEnabled ? parseWhitelist(form.ipWhitelistText) : [],
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

async function runCreateAction(event: RequestEvent, status: ExamPublishStatus) {
  const limited = await consumeFormRateLimit(event);
  if (limited) return limited;

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

  // Defence in depth: reject POSTs that retarget to a different course via the hidden form field.
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
    // `message()` narrows status to the superforms-accepted literal
    // union — collapse 4xx domain errors to 400 for the surface.
    return message<FormMessage>(
      form,
      { kind: "error", text: classified.message },
      { status: 400 },
    );
  }

  redirect(303, `/exams/${examId}`);
}

export const actions = {
  saveDraft: (event) => runCreateAction(event, "draft"),
  publish: (event) => runCreateAction(event, "published"),
} satisfies Actions;
