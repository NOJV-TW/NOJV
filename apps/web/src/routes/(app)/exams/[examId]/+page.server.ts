import { activityGradingUpdateSchema } from "@nojv/core";
import { error, fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import {
  examSettingsFormSchema,
  examUpdateSchema,
  parseIpWhitelistText,
  type ExamSettingsForm,
} from "@nojv/core";
import { examDomain } from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import { withAction } from "$lib/server/shared/action-handlers";
import { classifyRequestError } from "$lib/server/shared/handle-action-error";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import {
  serializePlagiarismFlags,
  serializePlagiarismReport,
} from "$lib/server/shared/plagiarism-view";
import { toDateTimeLocal, toIsoOrUndefined } from "$lib/server/shared/form-utils";
import { buildExamResults, type ExamResults } from "$lib/server/results/exam";
import type { FormMessage } from "$lib/types/form-message";

const { deleteExamDraft, getExamPageView, publishExam, updateExamRecord } = examDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  event.depends("submission:data");
  const parent = await event.parent();
  const { exam: examHeader, isManager } = parent;
  if (isManager) event.setHeaders({ "cache-control": "private, no-store" });
  const actor = requireAuth(event);
  const examId = event.params.examId;

  const view = await getExamPageView(actor, { examId, isManager });
  const { detail, matrix } = view;

  const results: ExamResults | null = matrix ? buildExamResults(matrix, actor.userId) : null;

  if (detail?.courseId !== examHeader.courseId) {
    error(404, "Exam not found");
  }

  const settingsForm =
    isManager && detail.manager
      ? await superValidate<ExamSettingsForm, FormMessage>(
          {
            title: detail.title,
            examPasswordEnabled: detail.manager.examPasswordEnabled,
            summary: detail.summary,
            startsAt: toDateTimeLocal(detail.startsAt),
            endsAt: toDateTimeLocal(detail.endsAt),
            dueAt: toDateTimeLocal(detail.dueAt ?? detail.endsAt),
            allowLateSubmissions:
              !!detail.dueAt && new Date(detail.endsAt) > new Date(detail.dueAt),
            latePenalty: detail.latePenalty,
            scoringMode: "point_sum",
            scoreboardMode: detail.scoreboardMode,
            allowedLanguages: detail.manager.allowedLanguages,
            submitCooldownSec: detail.manager.submitCooldownSec,
            pageLockEnabled: detail.pageLockEnabled,
            ipBindingEnabled: detail.ipBindingEnabled,
            ipViolationMode: detail.ipViolationMode,
            ipWhitelistEnabled: detail.ipWhitelistEnabled,
            ipWhitelistText: detail.manager.ipWhitelist.join("\n"),
          },
          zod4(examSettingsFormSchema),
        )
      : null;

  return {
    ...view,
    detail,
    isManager,
    activeSessionCount: view.activeSessions.length,
    courseId: examHeader.courseId,
    settingsForm,
    results,
    plagiarism: serializePlagiarismReport(view.plagiarism),
    plagiarismFlags: serializePlagiarismFlags(view.plagiarismFlags),
  };
});

export const actions = {
  updateCredentialPassword: withAction(async (event) => {
    const actor = requireAuth(event);
    const form = await event.request.formData();
    const userId = form.get("userId");
    const password = form.get("password");
    if (typeof userId !== "string" || typeof password !== "string") {
      return fail(400, { error: "Enter the student and a temporary password." });
    }
    await examDomain.credentials.setPassword(actor, event.params.examId, userId, password);
    return { success: true };
  }),
  startExam: withAction(async (event) => {
    const actor = requireAuth(event);
    const examId = event.params.examId;
    const clientIp = getClientIp(event);
    await examDomain.session.startSessionWithGate(actor, { examId, ip: clientIp });
    return { success: true };
  }),

  releaseSession: withAction(async (event) => {
    const actor = requireAuth(event);
    await examDomain.session.endSession(actor, {
      examId: event.params.examId,
      reason: "submitted",
    });
    return { success: true };
  }),

  releaseAllSessions: withAction(async (event) => {
    const actor = requireAuth(event);
    await examDomain.session.releaseAllSessionsAsInstructor(actor, {
      examId: event.params.examId,
    });
    return { success: true };
  }),

  releaseStudentSession: withAction(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    const targetUserId = formData.get("targetUserId");
    if (typeof targetUserId !== "string" || targetUserId.length === 0) {
      return fail(400, { error: "Missing target user." });
    }
    await examDomain.session.releaseSessionAsInstructor(actor, {
      examId: event.params.examId,
      targetUserId,
    });
    return { success: true };
  }),

  resetStudentIpBinding: withAction(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    const targetUserId = formData.get("targetUserId");
    if (typeof targetUserId !== "string" || targetUserId.length === 0) {
      return fail(400, { error: "Missing target user." });
    }
    await examDomain.session.resetStudentIpBinding(actor, {
      examId: event.params.examId,
      targetUserId,
    });
    return { success: true };
  }),

  updateSettings: withAction(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ExamSettingsForm, FormMessage>(
      event,
      zod4(examSettingsFormSchema),
    );
    if (!form.valid) {
      return fail(400, { form });
    }

    const parsed = examUpdateSchema.safeParse({
      title: form.data.title,
      examPasswordEnabled: form.data.examPasswordEnabled,
      summary: form.data.summary ? form.data.summary : undefined,
      startsAt: toIsoOrUndefined(form.data.startsAt),
      endsAt: toIsoOrUndefined(
        form.data.allowLateSubmissions ? form.data.endsAt : form.data.dueAt,
      ),
      dueAt: toIsoOrUndefined(form.data.dueAt),
      adjustmentRules:
        form.data.allowLateSubmissions && form.data.latePenalty ? [form.data.latePenalty] : [],
      scoringMode: form.data.scoringMode,
      scoreboardMode: form.data.scoreboardMode,
      allowedLanguages: form.data.allowedLanguages,
      submitCooldownSec: form.data.submitCooldownSec,
      pageLockEnabled: form.data.pageLockEnabled,
      ipBindingEnabled: form.data.ipBindingEnabled,
      ipViolationMode: form.data.ipViolationMode,
      ipWhitelistEnabled: form.data.ipWhitelistEnabled,
      ipWhitelist: form.data.ipWhitelistEnabled
        ? parseIpWhitelistText(form.data.ipWhitelistText)
        : [],
    });
    if (!parsed.success) {
      return message<FormMessage>(
        form,
        { kind: "error", text: parsed.error.issues[0]?.message ?? "validation_failed" },
        { status: 400 },
      );
    }

    try {
      await updateExamRecord(actor, event.params.examId, parsed.data);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }

    return message<FormMessage>(form, {
      kind: "success",
      text: "Saved.",
    });
  }),

  publishExam: withAction(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ExamSettingsForm, FormMessage>(
      event,
      zod4(examSettingsFormSchema),
    );
    try {
      await publishExam(actor, event.params.examId);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }
    return { success: true };
  }),

  deleteExam: withAction(async (event) => {
    const actor = requireAuth(event);
    const form = await superValidate<ExamSettingsForm, FormMessage>(
      event,
      zod4(examSettingsFormSchema),
    );
    try {
      await deleteExamDraft(actor, event.params.examId);
    } catch (err) {
      const classified = classifyRequestError(err, event);
      return message<FormMessage>(
        form,
        { kind: "error", text: classified.message },
        { status: classified.status },
      );
    }
    redirect(303, "/exams");
  }),

  updateProblems: withAction(async (event) => {
    const actor = requireAuth(event);
    const formData = await event.request.formData();
    const raw = formData.get("payload");
    let payload: unknown;
    try {
      payload = JSON.parse(typeof raw === "string" ? raw : "");
    } catch {
      return fail(400, { error: "Invalid grading payload" });
    }
    const parsed = activityGradingUpdateSchema.safeParse(payload);
    if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message });
    await updateExamRecord(actor, event.params.examId, parsed.data);

    return { success: true };
  }),
} satisfies Actions;
